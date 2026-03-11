-- 컨트롤러에서 사용될 프로시저 생성

-- 1. OrgController::createNode
CREATE OR REPLACE FUNCTION create_top_node(
    p_node_type VARCHAR,
    p_name VARCHAR,
    p_user_id VARCHAR,
    p_role_name VARCHAR DEFAULT 'ADMIN'
) RETURNS INTEGER AS $$
DECLARE
    v_new_node_id INTEGER;
BEGIN
    -- 1. 노드 생성 (nextval과 path 처리)
    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        nextval('organization_nodes_node_id_seq'),
        p_node_type,
        NULL,
        p_name,
        ARRAY[currval('organization_nodes_node_id_seq')]
    )
    RETURNING node_id INTO v_new_node_id;

    -- 2. 역할 배정 (role_assignments 테이블)
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (p_user_id, v_new_node_id, p_role_name);

    -- 생성된 노드 ID 반환
    RETURN v_new_node_id;
END;
$$ LANGUAGE plpgsql;


-- 2. UserController::register_user
CREATE OR REPLACE FUNCTION register_user(
    p_user_id VARCHAR,
    p_email VARCHAR,
    p_name VARCHAR,
    p_password_hash TEXT
) RETURNS VOID AS $$
DECLARE
    v_new_node_id INTEGER;
BEGIN
    -- 1. 유저 생성
    INSERT INTO users (user_id, email, name, password_hash)
    VALUES (p_user_id, p_email, p_name, p_password_hash);

    -- 2. 개인 전용 노드 생성
    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        nextval('organization_nodes_node_id_seq'),
        'USER',
        NULL,
        p_name || ' 개인공간',
        ARRAY[currval('organization_nodes_node_id_seq')]
    )
    RETURNING node_id INTO v_new_node_id;

    -- 3. 생성된 노드 ID를 유저 테이블에 업데이트
    UPDATE users 
    SET personal_node_id = v_new_node_id 
    WHERE user_id = p_user_id;

    -- 4. 개인 노드에 대한 관리자(ADMIN) 권한 부여
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (p_user_id, v_new_node_id, 'ADMIN');

END;
$$ LANGUAGE plpgsql;

-- 3. RoleController::add_role
CREATE OR REPLACE FUNCTION add_role(
    p_email VARCHAR,
    p_node_id INTEGER,
    p_role_name VARCHAR
) RETURNS INTEGER AS $$
DECLARE
    v_new_role_id INTEGER;
BEGIN
    -- 1. 이메일로 유저 검색 후 노드에 추가
    WITH selected_user AS (
      SELECT user_id FROM users WHERE email = p_email
    )
    INSERT INTO role_assignments (user_id, node_id, role) 
    SELECT user_id, p_node_id, p_role_name
    FROM selected_user
    RETURNING assignment_id INTO v_new_role_id;

    RETURN v_new_role_id;
END;
$$ LANGUAGE plpgsql;