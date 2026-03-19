-- 컨트롤러에서 사용될 프로시저 생성

-- 1. OrgController::createTopNode
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

-- 4. WorkItemController::createWorkItem
CREATE OR REPLACE FUNCTION create_work_item(
    p_work_item_id VARCHAR,
    p_owner_node_id INTEGER,
    p_owner_user_id VARCHAR,
    p_title VARCHAR,
    p_parent_work_item_id VARCHAR DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_status VARCHAR DEFAULT 'todo',
    p_priority INTEGER DEFAULT 3,
    p_weight INTEGER DEFAULT 1,
    p_progress INTEGER DEFAULT 0,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS VARCHAR AS $$
DECLARE
    v_ret_id VARCHAR;
BEGIN
    INSERT INTO work_items (
        work_item_id, 
        owner_node_id, 
        owner_user_id, 
        title, 
        parent_work_item_id, 
        description, 
        status, 
        priority, 
        weight, 
        progress, 
        start_date, 
        due_date
    ) VALUES (
        p_work_item_id,
        p_owner_node_id,
        p_owner_user_id,
        p_title,
        NULLIF(p_parent_work_item_id, ''),
        NULLIF(p_description, ''),
        COALESCE(NULLIF(p_status, ''), 'todo'),
        COALESCE(p_priority, 3),
        COALESCE(p_weight, 1),
        COALESCE(p_progress, 0),
        NULLIF(p_start_date, '')::DATE,
        NULLIF(p_due_date, '')::DATE
    )
    RETURNING work_item_id INTO v_ret_id;

    RETURN v_ret_id;
END;
$$ LANGUAGE plpgsql;

-- 5. OrgController::createSubNode
CREATE OR REPLACE FUNCTION create_sub_node(
    p_node_type VARCHAR,
    p_parent_node_id INTEGER,
    p_name VARCHAR,
    p_email VARCHAR,
    p_role_name VARCHAR
) RETURNS INTEGER AS $$
DECLARE
    v_new_node_id INTEGER;
BEGIN
    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        nextval('organization_nodes_node_id_seq'),
        p_node_type,
        p_parent_node_id,
        p_name,
        ARRAY[currval('organization_nodes_node_id_seq')]
    )
    RETURNING node_id INTO v_new_node_id;

    UPDATE organization_nodes 
    SET path = (SELECT path FROM organization_nodes WHERE node_id = p_parent_node_id) || v_new_node_id
    WHERE node_id = v_new_node_id;
    
    WITH selected_user AS (
      SELECT user_id FROM users WHERE email = p_email
    )
    INSERT INTO role_assignments (user_id, node_id, role) 
    SELECT user_id, v_new_node_id, p_role_name 
    FROM selected_user;


    RETURN v_new_node_id;
END;
$$ LANGUAGE plpgsql;

-- 6. ContextController::getInitialContext
CREATE OR REPLACE FUNCTION get_initial_context(
    p_user_id VARCHAR
) 
RETURNS TABLE (
    out_type TEXT,
    out_id TEXT,
    out_parent_id TEXT,
    out_title TEXT,
    out_status TEXT,
    out_priority INTEGER,
    out_extra_info TEXT,
    out_updated_at TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE accessible_node_ids AS (
        SELECT node_id FROM role_assignments WHERE user_id = p_user_id
        
        UNION

        SELECT n.node_id 
        FROM organization_nodes n
        JOIN accessible_node_ids a ON n.parent_node_id = a.node_id
    )

    SELECT 
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM accessible_node_ids)

    UNION ALL

    SELECT 
        'WORK_ITEM'::TEXT,
        w.work_item_id::TEXT,
        w.owner_node_id::TEXT,
        w.title::TEXT,
        w.status::TEXT,
        w.priority::INTEGER,
        w.parent_work_item_id::TEXT,
        w.updated_at::TEXT
    FROM work_items w
    WHERE w.owner_node_id IN (SELECT node_id FROM accessible_node_ids);
END;
$$ LANGUAGE plpgsql;