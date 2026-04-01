-- 컨트롤러에서 사용될 organization_nodes 관련 함수 생성

-- OrgController::createTopNode
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
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id;
END;
$$ LANGUAGE plpgsql;


-- OrgController::createSubNode
CREATE OR REPLACE FUNCTION create_sub_node(
    p_requester_email VARCHAR,
    p_node_type VARCHAR,
    p_parent_node_id INTEGER,
    p_name VARCHAR,
    p_owner_user_email VARCHAR,
    p_role_name VARCHAR
) RETURNS TABLE (
    out_status BOOLEAN,
    out_message TEXT,
    out_type TEXT,
    out_id TEXT,
    out_parent_id TEXT,
    out_title TEXT,
    out_extra_info TEXT,
    out_updated_at TEXT
) AS $$
DECLARE
    v_requester_id VARCHAR;
    v_owner_user_id VARCHAR;
    v_requester_role VARCHAR;
    v_new_node_id INTEGER;
    v_parent_path INTEGER[];
BEGIN
    -- 1. 사용자 id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;

    IF v_requester_id IS NULL OR v_owner_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '대상 사용자를 찾을 수 없습니다.'::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- 2. 요청자 권한 확인
    SELECT role INTO v_requester_role
    FROM role_assignments
    WHERE user_id = v_requester_id AND node_id = p_parent_node_id;

    IF v_requester_role IS NULL OR v_requester_role NOT IN ('ADMIN', 'MANAGER') THEN
        RETURN QUERY SELECT FALSE, '권한이 부족합니다. (ADMIN 또는 MANAGER 권한 필요)'::TEXT,  NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    -- 3. 하위 노드 생성
    SELECT path INTO v_parent_path FROM organization_nodes WHERE node_id = p_parent_node_id;
    v_new_node_id := nextval('organization_nodes_node_id_seq');

    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        v_new_node_id,
        p_node_type,
        p_parent_node_id,
        p_name,
        v_parent_path || v_new_node_id
    );
    
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_owner_user_id, v_new_node_id, p_role_name);

    -- 4. 생성된 노드 정보 즉시 반환
    RETURN QUERY
    SELECT 
        TRUE,
        '하위 노드가 성공적으로 생성되었습니다.'::TEXT,
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id;
END;
$$ LANGUAGE plpgsql;