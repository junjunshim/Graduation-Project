-- 컨트롤러에서 사용될 role_assignments 관련 함수 생성

-- RoleController::add_role
CREATE OR REPLACE FUNCTION add_role(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_role_name role_assignments.role%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_requester_role role_assignments.role%TYPE;
    v_new_id role_assignments.assignment_id%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 타켓 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_target_id FROM users WHERE email = p_target_email;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Target user does not exist : %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자 권한 체크 (NODE_ADD_ROLE 권한 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have authority to add role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 이미 역할이 있는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0402]Target user already has a role on this node : %', p_target_email
        USING ERRCODE = 'P0402';
    END IF;

    -- 5. 권한 부여 실행
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_target_id, p_node_id, p_role_name)
    RETURNING assignment_id INTO v_new_id;

    RETURN QUERY SELECT 
        'ROLE'::TEXT,
        p_node_id::TEXT,
        NULL::TEXT,
        NULL::TEXT,
        p_target_email::TEXT,
        p_role_name::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        r.updated_at::TEXT
    FROM role_assignments r
    WHERE assignment_id = v_new_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN SQLSTATE 'P0402' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0401]Failed to assign role to user : %, (REASON: %)', p_target_email, SQLERRM
        USING ERRCODE = 'P0401';
END;
$$ LANGUAGE plpgsql;

-- RoleController::update_role
CREATE OR REPLACE FUNCTION update_role(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_change_role_name role_assignments.role%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
BEGIN
    -- 0. 입력 값 검증 (NULL and admin은 변경 불가)
    IF 
        p_change_role_name IS NULL
        OR
        p_change_role_name = 'ADMIN'
    THEN
        RAISE EXCEPTION '[P0405]Invalid role provided for update : %', p_change_role_name
        USING ERRCODE = 'P0405';
    END IF;

    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 타켓 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_target_id FROM users WHERE email = p_target_email;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Target user does not exist : %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자 권한 체크 (NODE_ADD_ROLE 권한 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have authority to add role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 타켓 사용자가 해당 노드에 권한이 있는지 확인
    IF NOT EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0403]Target user does not have a role on this node : %', p_target_email
        USING ERRCODE = 'P0403';
    END IF;

    -- 5. 타켓 사용자가 ADMIN 권한인 경우 변경 불가
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id AND role = 'ADMIN') THEN
        RAISE EXCEPTION '[P0404]Cannot change role of an ADMIN user : %', p_target_email
        USING ERRCODE = 'P0404';
    END IF;

    -- 6. 새로운 권한 부여
    UPDATE role_assignments
    SET role = p_change_role_name
    WHERE user_id = v_target_id AND node_id = p_node_id;

    -- 7. 결과 반환
    RETURN QUERY SELECT 
        'ROLE'::TEXT,
        p_node_id::TEXT,
        NULL::TEXT,
        NULL::TEXT,
        p_target_email::TEXT,
        r.role::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        r.updated_at::TEXT
    FROM role_assignments r
    WHERE user_id = v_target_id AND node_id = p_node_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN SQLSTATE 'P0403' OR SQLSTATE 'P0404' OR SQLSTATE 'P0405' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0406]Failed to update role of user : %, (REASON: %)', p_target_email, SQLERRM
        USING ERRCODE = 'P0406';
END;
$$ LANGUAGE plpgsql;
