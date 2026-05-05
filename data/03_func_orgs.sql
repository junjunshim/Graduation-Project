-- 컨트롤러에서 사용될 organization_nodes 관련 함수 생성

-- OrgController::createTopNode
CREATE OR REPLACE FUNCTION create_top_node(
    p_email users.email%TYPE,
    p_node_type organization_nodes.node_type%TYPE,
    p_name organization_nodes.name%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_new_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 생성
    INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
    VALUES (
        p_node_type,
        NULL,
        p_name,
        '{}'::INTEGER[]
    ) RETURNING node_id INTO v_new_node_id;

     -- 3. 생성된 노드의 path 업데이트 (자기 자신을 포함)
    UPDATE organization_nodes
    SET path = ARRAY[v_new_node_id]
    WHERE node_id = v_new_node_id;

    -- 3. 소유자 배정 (role_assignments 테이블)
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_user_id, v_new_node_id, 'ADMIN');

    -- 4. 노드에 대한 기본 권한 설정
    PERFORM default_node_authority(v_new_node_id);

    -- 5. 생성된 노드관련 정보 즉시 반환
    RETURN QUERY
    SELECT 
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.node_type::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id

    UNION ALL 

    SELECT 
        'ROLE'::TEXT,
        ra.assignment_id::TEXT,
        NULL::TEXT,
        ra.node_id::TEXT,
        u.email::TEXT,
        ra.role::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        ra.updated_at::TEXT
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT 
        'AUTHORITY'::TEXT,
        a.authority_id::TEXT,
        NULL::TEXT,
        a.node_id::TEXT,
        NULL::TEXT,
        a.role::TEXT,
        a.authority::INTEGER,
        NULL::TEXT,
        a.updated_at::TEXT
    FROM role_authorities a
    WHERE a.node_id = v_new_node_id;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0301]Error creating top-node: %, requester: %  (REASON: %)', p_name, p_email, SQLERRM
        USING ERRCODE = 'P0301';
END;
$$ LANGUAGE plpgsql;


-- OrgController::createSubNode
CREATE OR REPLACE FUNCTION create_sub_node(
    p_requester_email users.email%TYPE,
    p_node_type organization_nodes.node_type%TYPE,
    p_parent_node_id organization_nodes.node_id%TYPE,
    p_name organization_nodes.name%TYPE,
    p_owner_user_email users.email%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_new_node_id organization_nodes.node_id%TYPE;
    v_parent_path organization_nodes.path%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 소유자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;

    IF v_owner_user_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Owner user does not exist : %', p_owner_user_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 요청자 권한 확인
    IF NOT check_authority_with_override(v_requester_id, p_parent_node_id, 'NODE_SUB_CREATE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. (sub node creation) for user: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 소유자 권한 확인 (소유자는 최소 MEMBER 권한 필요)
    IF NOT check_authority_with_override(v_owner_user_id, p_parent_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. (owner user must have at least MEMBER role) for user: %', p_owner_user_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 하위 노드 생성
    SELECT path INTO v_parent_path FROM organization_nodes WHERE node_id = p_parent_node_id;

    INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
    VALUES (
        p_node_type,
        p_parent_node_id,
        p_name,
        '{}'::INTEGER[]
    ) RETURNING node_id INTO v_new_node_id;

    -- 4. 생성된 노드의 path 업데이트 (부모 노드의 path + 자기 자신)
    UPDATE organization_nodes
    SET path = v_parent_path || v_new_node_id
    WHERE node_id = v_new_node_id;
    
    -- 5. 소유자 배정 (role_assignments 테이블)
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_owner_user_id, v_new_node_id, 'ADMIN');

    -- 6. 노드에 대한 기본 권한 설정
    PERFORM default_node_authority(v_new_node_id);

    -- 7. 생성된 노드 정보 즉시 반환
    RETURN QUERY
    SELECT 
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.node_type::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id

    UNION ALL

    SELECT 
        'ROLE'::TEXT,
        ra.assignment_id::TEXT,
        NULL::TEXT,
        ra.node_id::TEXT,
        u.email::TEXT,
        ra.role::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        ra.updated_at::TEXT
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT 
        'AUTHORITY'::TEXT,
        a.authority_id::TEXT,
        NULL::TEXT,
        a.node_id::TEXT,
        NULL::TEXT,
        a.role::TEXT,
        a.authority::INTEGER,
        NULL::TEXT,
        a.updated_at::TEXT
    FROM role_authorities a
    WHERE a.node_id = v_new_node_id;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0302]Error creating sub-node: %, requester: %  (REASON: %)', p_name, p_requester_email, SQLERRM
        USING ERRCODE = 'P0302';
END;
$$ LANGUAGE plpgsql;

-- OrgController::updateNode
CREATE OR REPLACE FUNCTION update_node(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_name organization_nodes.name%TYPE,
    p_node_type organization_nodes.node_type%TYPE
) RETURNS SETOF action_result AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_requester_role role_assignments.role%TYPE;
BEGIN
    -- 1. 사용자 id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 
            '사용자를 찾을 수 없습니다.'::TEXT, 
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::TEXT;
        RETURN;
    END IF;

    -- 2. 요청자 권한 확인
    SELECT role INTO v_requester_role
    FROM role_assignments
    WHERE user_id = v_requester_id AND node_id = p_node_id;

    IF v_requester_role IS NULL OR v_requester_role NOT IN ('ADMIN', 'MANAGER') THEN
        RETURN QUERY SELECT 
            FALSE, 
            '권한이 부족합니다. (ADMIN 또는 MANAGER 권한 필요)'::TEXT, 
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::TEXT,
            NULL::INTEGER,
            NULL::TEXT,
            NULL::TEXT;
        RETURN;
    END IF;

    -- 3. 노드 업데이트
    UPDATE organization_nodes
    SET name = p_name, node_type = p_node_type
    WHERE node_id = p_node_id;

    -- 4. 업데이트된 노드 정보 즉시 반환
    RETURN QUERY
    SELECT 
        TRUE,
        '노드가 성공적으로 업데이트되었습니다.'::TEXT,
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.node_type::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id = p_node_id;
END;
$$ LANGUAGE plpgsql;