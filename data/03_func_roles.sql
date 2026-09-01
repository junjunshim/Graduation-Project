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

    -- 4. 해당 노드에 등록된 역할인지 확인 (ADMIN이 아니면 role_authorities에 정의되어 있어야 함)
    IF NOT EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND role = p_role_name) THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 5. 이미 역할이 있는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0402]Target user already has a role on this node : %', p_target_email
        USING ERRCODE = 'P0402';
    END IF;

    -- 6. 권한 부여 실행
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_target_id, p_node_id, p_role_name)
    RETURNING assignment_id INTO v_new_id;

    -- 6.5 최근 활동 피드 로깅
    DECLARE
        v_target_name users.name%TYPE;
    BEGIN
        SELECT name INTO v_target_name FROM users WHERE user_id = v_target_id;
        PERFORM log_activity(p_node_id, p_requester_email, 'ROLE', v_new_id::VARCHAR, v_target_name, 'inserted', 'role', NULL, p_role_name::TEXT);
    END;

    RETURN QUERY SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', r.assignment_id,
        'node_id', r.node_id,
        'email', p_target_email,
        'role', r.role,
        'updated_at', r.updated_at
    )
    FROM role_assignments r
    WHERE assignment_id = v_new_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN SQLSTATE 'P0402' OR SQLSTATE 'P0407' THEN
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
    v_old_role role_assignments.role%TYPE;
    v_target_name users.name%TYPE;
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
    SELECT user_id, name INTO v_target_id, v_target_name FROM users WHERE email = p_target_email;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Target user does not exist : %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자 권한 체크 (NODE_ADD_ROLE 권한 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have authority to add role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 변경하려는 역할이 해당 노드에 등록되어 있는지 확인
    IF NOT EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND role = p_change_role_name) THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_change_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 5. 타켓 사용자가 해당 노드에 권한이 있는지 확인 및 기존 권한 가져오기
    SELECT role INTO v_old_role FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0403]Target user does not have a role on this node : %', p_target_email
        USING ERRCODE = 'P0403';
    END IF;

    -- 6. 타켓 사용자가 ADMIN 권한인 경우 변경 불가
    IF v_old_role = 'ADMIN' THEN
        RAISE EXCEPTION '[P0404]Cannot change role of an ADMIN user : %', p_target_email
        USING ERRCODE = 'P0404';
    END IF;

    -- 7. 새로운 권한 부여
    UPDATE role_assignments
    SET role = p_change_role_name
    WHERE user_id = v_target_id AND node_id = p_node_id;

    -- 7.5 최근 활동 피드 로깅
    DECLARE
        v_assignment_id INTEGER;
    BEGIN
        SELECT assignment_id INTO v_assignment_id FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id;
        PERFORM log_activity(p_node_id, p_requester_email, 'ROLE', v_assignment_id::VARCHAR, v_target_name, 'updated', 'role', v_old_role::TEXT, p_change_role_name::TEXT);
    END;

    -- 8. 결과 반환
    RETURN QUERY SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', r.assignment_id,
        'node_id', r.node_id,
        'email', p_target_email,
        'role', r.role,
        'updated_at', r.updated_at
    )
    FROM role_assignments r
    WHERE user_id = v_target_id AND node_id = p_node_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0403' OR SQLSTATE 'P0404' OR SQLSTATE 'P0405' OR SQLSTATE 'P0407' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0406]Failed to update role of user : %, (REASON: %)', p_target_email, SQLERRM
            USING ERRCODE = 'P0406';
END;
$$ LANGUAGE plpgsql;


-- RoleController::create_role_definition (노드별 신규 역할 및 권한 정의 생성)
CREATE OR REPLACE FUNCTION create_role_definition(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_role_name role_authorities.role%TYPE,
    p_authority VARCHAR(24)
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_authority_id role_authorities.authority_id%TYPE;
    v_authority_bit BIT(24);
BEGIN
    -- 0. 입력값 및 비트 변환 검증
    IF p_role_name IS NULL OR TRIM(p_role_name) = '' THEN
        RAISE EXCEPTION '[P0408]Role name cannot be empty'
        USING ERRCODE = 'P0408';
    END IF;

    -- ADMIN 역할은 시스템 생성 전용
    IF UPPER(p_role_name) = 'ADMIN' THEN
        RAISE EXCEPTION '[P0409]Cannot create ADMIN role'
        USING ERRCODE = 'P0409';
    END IF;

    BEGIN
        v_authority_bit := p_authority::BIT(24);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '[P0410]Invalid 24-bit authority bit string: %', p_authority
        USING ERRCODE = 'P0410';
    END;

    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 요청자 권한 체크 (ROLE_CHANGE: bit 15 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'ROLE_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have ROLE_CHANGE authority on node : %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 이미 존재하는 역할인지 확인 (중복 생성 방지)
    IF EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND role = p_role_name) THEN
        RAISE EXCEPTION '[P0412]Role already exists on this node: %', p_role_name
        USING ERRCODE = 'P0412';
    END IF;

    -- 4. 신규 역할 권한 등록
    INSERT INTO role_authorities (node_id, role, authority)
    VALUES (p_node_id, p_role_name, v_authority_bit)
    RETURNING authority_id INTO v_authority_id;

    -- 5. 최근 활동 피드 로깅
    PERFORM log_activity(p_node_id, p_requester_email, 'AUTHORITY', v_authority_id::VARCHAR, p_role_name, 'inserted', 'authority', NULL, v_authority_bit::TEXT);

    -- 6. 생성된 권한 객체 반환
    RETURN QUERY SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE authority_id = v_authority_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0408' OR SQLSTATE 'P0409' OR SQLSTATE 'P0410' OR SQLSTATE 'P0412' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0411]Failed to create role definition : %, (REASON: %)', p_role_name, SQLERRM
            USING ERRCODE = 'P0411';
END;
$$ LANGUAGE plpgsql;


-- RoleController::update_role_authority (노드별 역할 권한 수정)
CREATE OR REPLACE FUNCTION update_role_authority(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_role_name role_authorities.role%TYPE,
    p_authority VARCHAR(24)
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_authority_id role_authorities.authority_id%TYPE;
    v_authority_bit BIT(24);
    v_old_authority BIT(24);
BEGIN
    -- 0. 입력값 및 비트 변환 검증
    IF p_role_name IS NULL OR TRIM(p_role_name) = '' THEN
        RAISE EXCEPTION '[P0408]Role name cannot be empty'
        USING ERRCODE = 'P0408';
    END IF;

    -- ADMIN 역할의 권한 임의 수정 방지
    IF UPPER(p_role_name) = 'ADMIN' THEN
        RAISE EXCEPTION '[P0409]Cannot modify ADMIN role authority'
        USING ERRCODE = 'P0409';
    END IF;

    BEGIN
        v_authority_bit := p_authority::BIT(24);
    EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION '[P0410]Invalid 24-bit authority bit string: %', p_authority
        USING ERRCODE = 'P0410';
    END;

    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 요청자 권한 체크 (ROLE_CHANGE: bit 15 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'ROLE_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have ROLE_CHANGE authority on node : %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 기존 권한 조회 (수정 대상이 존재하는지 확인)
    SELECT authority_id, authority INTO v_authority_id, v_old_authority 
    FROM role_authorities 
    WHERE node_id = p_node_id AND role = p_role_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 4. 권한 비트 수정
    UPDATE role_authorities
    SET authority = v_authority_bit
    WHERE authority_id = v_authority_id;

    -- 5. 최근 활동 피드 로깅
    PERFORM log_activity(p_node_id, p_requester_email, 'AUTHORITY', v_authority_id::VARCHAR, p_role_name, 'updated', 'authority', v_old_authority::TEXT, v_authority_bit::TEXT);

    -- 6. 수정된 권한 객체 반환
    RETURN QUERY SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE authority_id = v_authority_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0407' OR SQLSTATE 'P0408' OR SQLSTATE 'P0409' OR SQLSTATE 'P0410' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0413]Failed to update role authority : %, (REASON: %)', p_role_name, SQLERRM
            USING ERRCODE = 'P0413';
END;
$$ LANGUAGE plpgsql;
