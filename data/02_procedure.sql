-- 컨트롤러에서 사용될 프로시저 생성

-- 1. OrgController::createTopNode
CREATE OR REPLACE FUNCTION create_top_node(
    p_email VARCHAR,
    p_node_type VARCHAR,
    p_name VARCHAR,
    p_role_name VARCHAR DEFAULT 'ADMIN'
) RETURNS TABLE (
    out_type TEXT,
    out_id TEXT,
    out_parent_id TEXT,
    out_title TEXT,
    out_status TEXT,
    out_priority INTEGER,
    out_extra_info TEXT,
    out_updated_at TEXT
) AS $$
DECLARE
    v_user_id VARCHAR;
    v_new_node_id INTEGER;
BEGIN
    -- 1. 사용자 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_email;

    -- 2. 노드 생성 (nextval과 path 처리)
    v_new_node_id := nextval('organization_nodes_node_id_seq');

    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        v_new_node_id,
        p_node_type,
        NULL,
        p_name,
        ARRAY[v_new_node_id]
    );

    -- 3. 역할 배정 (role_assignments 테이블)
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_user_id, v_new_node_id, p_role_name);
    
    -- 4. 생성된 노드 정보 즉시 반환
    RETURN QUERY
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
    WHERE n.node_id = v_new_node_id;
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
    p_requester_email VARCHAR,
    p_target_email VARCHAR,
    p_node_id INTEGER,
    p_role_name VARCHAR
) RETURNS TABLE (
    out_status BOOLEAN,
    out_message TEXT,
    out_node_id TEXT,
    out_user_email TEXT,
    out_role TEXT
) AS $$
DECLARE
    v_requester_id VARCHAR;
    v_target_id VARCHAR;
    v_requester_role VARCHAR;
    v_new_id INTEGER;
BEGIN
    -- 1. 요청자와 대상자의 user_id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    SELECT user_id INTO v_target_id FROM users WHERE email = p_target_email;

    IF v_target_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '대상 사용자를 찾을 수 없습니다.'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- 2. 요청자의 현재 노드 권한 확인
    SELECT role INTO v_requester_role 
    FROM role_assignments 
    WHERE user_id = v_requester_id AND node_id = p_node_id;

    -- 3. 권한 체크 (ADMIN 또는 MANAGER만 타인에게 권한 부여 가능)
    IF v_requester_role IS NULL OR v_requester_role NOT IN ('ADMIN', 'MANAGER') THEN
        RETURN QUERY SELECT FALSE, '권한이 부족합니다. (ADMIN 또는 MANAGER 권한 필요)'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- 4. 이미 권한이 있는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RETURN QUERY SELECT FALSE, '해당 사용자는 이미 이 노드에 권한이 있습니다.'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- 5. 권한 부여 실행
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_target_id, p_node_id, p_role_name)
    RETURNING assignment_id INTO v_new_id;

    RETURN QUERY SELECT TRUE, '성공적으로 권한이 부여되었습니다.'::TEXT, p_node_id::TEXT, p_target_email::TEXT, p_role_name::TEXT;
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
    p_user_email VARCHAR
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
        SELECT node_id FROM role_assignments WHERE user_id = (SELECT user_id FROM users WHERE email = p_user_email)
        
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

-- 7. ContextController::syncContext
CREATE OR REPLACE FUNCTION sync_context(
    p_user_email VARCHAR,
    p_last_synced_at TIMESTAMP
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
        SELECT node_id FROM role_assignments WHERE user_id = (SELECT user_id FROM users WHERE email = p_user_email)
        
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
      AND n.updated_at > p_last_synced_at

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
    WHERE w.owner_node_id IN (SELECT node_id FROM accessible_node_ids)
      AND w.updated_at > p_last_synced_at;
END;
$$ LANGUAGE plpgsql;

-- 8. AuthController::loginUser
CREATE OR REPLACE FUNCTION login_user (
    p_email VARCHAR,
    p_password TEXT,
    p_refresh_token TEXT,
    p_refresh_expiry TIMESTAMP
) 
RETURNS TABLE (
    status BOOLEAN,
    message TEXT
) AS $$
DECLARE
    v_user_password TEXT;
BEGIN
    SELECT password_hash INTO v_user_password
    FROM users
    WHERE email = p_email;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '사용자를 찾을 수 없습니다.'::TEXT;
        RETURN;
    END IF;

    IF v_user_password <> p_password THEN
        RETURN QUERY SELECT FALSE, '비밀번호가 일치하지 않습니다.'::TEXT;
        RETURN;
    END IF;

    INSERT INTO user_refresh_tokens (user_email, refresh_token, expires_at) 
    VALUES (p_email, p_refresh_token, p_refresh_expiry)
    ON CONFLICT (user_email) DO UPDATE SET
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at;
    
    RETURN QUERY SELECT TRUE, '로그인 성공'::TEXT;
END;
$$ LANGUAGE plpgsql;
