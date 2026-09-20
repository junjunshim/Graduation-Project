-- 컨트롤러에서 사용될 role_assignments 관련 함수 생성

-- RoleController::add_role
CREATE OR REPLACE FUNCTION add_role(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_role_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    p_role_name role_authorities.role%TYPE;
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_new_id role_assignments.assignment_id%TYPE;
BEGIN
    SELECT role INTO p_role_name FROM role_authorities WHERE authority_id = p_role_id AND node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node' USING ERRCODE = 'P0407';
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

    -- 3. 요청자 권한 체크 (해당 노드에 직접 부여된 NODE_ADD_ROLE 권한 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have authority to add role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 해당 노드에 등록된 역할인지 확인 (ADMIN이 아니면 role_authorities에 정의되어 있어야 함)
    IF NOT EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND authority_id = p_role_id) THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 5. 이미 역할이 있는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0402]Target user already has a role on this node : %', p_target_email
        USING ERRCODE = 'P0402';
    END IF;

    -- 6. 권한 부여 실행
    IF EXISTS (SELECT 1 FROM role_authorities WHERE authority_id = p_role_id AND is_top_role) THEN
        RAISE EXCEPTION '[P0409]Cannot assign the top role' USING ERRCODE = 'P0409';
    END IF;
    INSERT INTO role_assignments (user_id, node_id, role_id)
    VALUES (v_target_id, p_node_id, p_role_id)
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
        'user_id', r.user_id,
        'user_name', u.name,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = r.role_id),
        'role_id', r.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = r.role_id),
        'updated_at', r.updated_at
    )
    FROM role_assignments r
    JOIN users u ON r.user_id = u.user_id
    WHERE r.assignment_id = v_new_id;

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
    p_role_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    p_change_role_name role_authorities.role%TYPE;
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_old_role role_authorities.role%TYPE;
    v_target_name users.name%TYPE;
BEGIN
    SELECT role INTO p_change_role_name FROM role_authorities WHERE authority_id = p_role_id AND node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node' USING ERRCODE = 'P0407';
    END IF;
    -- 0. 입력 값 검증 (NULL and admin은 변경 불가)
    IF 
        p_change_role_name IS NULL
        OR
        EXISTS (SELECT 1 FROM role_authorities WHERE authority_id = p_role_id AND is_top_role)
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

    -- 3. 요청자 권한 체크 (해당 노드에 직접 부여된 NODE_ADD_ROLE 권한 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have authority to update role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 변경하려는 역할이 해당 노드에 등록되어 있는지 확인
    IF NOT EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND authority_id = p_role_id) THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_change_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 5. 타켓 사용자가 해당 노드에 권한이 있는지 확인 및 기존 권한 가져오기
    SELECT a.role INTO v_old_role FROM role_assignments r JOIN role_authorities a ON a.authority_id = r.role_id WHERE r.user_id = v_target_id AND r.node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0403]Target user does not have a role on this node : %', p_target_email
        USING ERRCODE = 'P0403';
    END IF;

    -- 6. 타켓 사용자가 ADMIN 권한인 경우 변경 불가
    IF EXISTS (SELECT 1 FROM role_assignments r JOIN role_authorities a ON a.authority_id = r.role_id WHERE r.user_id = v_target_id AND r.node_id = p_node_id AND a.is_top_role) THEN
        RAISE EXCEPTION '[P0404]Cannot change role of an ADMIN user : %', p_target_email
        USING ERRCODE = 'P0404';
    END IF;

    -- 7. 새로운 권한 부여
    UPDATE role_assignments
    SET role_id = p_role_id
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
        'user_id', r.user_id,
        'user_name', u.name,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = r.role_id),
        'role_id', r.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = r.role_id),
        'updated_at', r.updated_at
    )
    FROM role_assignments r
    JOIN users u ON r.user_id = u.user_id
    WHERE r.user_id = v_target_id AND r.node_id = p_node_id;

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

    -- 2. 요청자 권한 체크 (해당 노드에 직접 부여된 ROLE_CHANGE: bit 15 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'ROLE_CHANGE') THEN
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
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
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
    p_role_id INTEGER,
    p_authority VARCHAR(24)
) RETURNS SETOF integrated_data AS $$
DECLARE
    p_role_name role_authorities.role%TYPE;
    v_requester_id users.user_id%TYPE;
    v_authority_id role_authorities.authority_id%TYPE;
    v_authority_bit BIT(24);
    v_old_authority BIT(24);
BEGIN
    SELECT role INTO p_role_name FROM role_authorities WHERE authority_id = p_role_id AND node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node' USING ERRCODE = 'P0407';
    END IF;
    -- 0. 입력값 및 비트 변환 검증
    IF p_role_name IS NULL OR TRIM(p_role_name) = '' THEN
        RAISE EXCEPTION '[P0408]Role name cannot be empty'
        USING ERRCODE = 'P0408';
    END IF;

    -- ADMIN 역할의 권한 임의 수정 방지
    IF EXISTS (SELECT 1 FROM role_authorities WHERE authority_id = p_role_id AND is_top_role) THEN
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

    -- 2. 요청자 권한 체크 (해당 노드에 직접 부여된 ROLE_CHANGE: bit 15 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'ROLE_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have ROLE_CHANGE authority on node : %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 기존 권한 조회 (수정 대상이 존재하는지 확인)
    SELECT authority_id, authority INTO v_authority_id, v_old_authority 
    FROM role_authorities 
    WHERE node_id = p_node_id AND authority_id = p_role_id;

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
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
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


-- RoleController::rename_role_definition (노드별 역할명 변경)
CREATE OR REPLACE FUNCTION rename_role_definition(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_role_id INTEGER,
    p_new_role_name role_authorities.role%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    p_old_role_name role_authorities.role%TYPE;
    v_requester_id users.user_id%TYPE;
    v_authority_id role_authorities.authority_id%TYPE;
    v_authority_bit BIT(24);
BEGIN
    SELECT role INTO p_old_role_name FROM role_authorities WHERE authority_id = p_role_id AND node_id = p_node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node' USING ERRCODE = 'P0407';
    END IF;
    -- 0. 입력값 검증
    IF p_old_role_name IS NULL OR TRIM(p_old_role_name) = '' THEN
        RAISE EXCEPTION '[P0408]Old role name cannot be empty'
        USING ERRCODE = 'P0408';
    END IF;

    IF p_new_role_name IS NULL OR TRIM(p_new_role_name) = '' THEN
        RAISE EXCEPTION '[P0408]New role name cannot be empty'
        USING ERRCODE = 'P0408';
    END IF;

    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 요청자 권한 체크 (해당 노드에 직접 부여된 ROLE_CHANGE: bit 15 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'ROLE_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have ROLE_CHANGE authority on node : %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 기존 역할 정의 조회
    SELECT authority_id, authority INTO v_authority_id, v_authority_bit 
    FROM role_authorities 
    WHERE node_id = p_node_id AND authority_id = p_role_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role is not defined on this node: %', p_old_role_name
        USING ERRCODE = 'P0407';
    END IF;

    -- 4. 신규 역할명이 이미 해당 노드에 존재하는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_authorities WHERE node_id = p_node_id AND role = p_new_role_name AND authority_id <> p_role_id) THEN
        RAISE EXCEPTION '[P0412]Role already exists on this node: %', p_new_role_name
        USING ERRCODE = 'P0412';
    END IF;

    -- 5. role_authorities 테이블에서 역할명 갱신
    UPDATE role_authorities
    SET role = p_new_role_name
    WHERE authority_id = v_authority_id;

    -- 7. 최근 활동 피드 로깅
    PERFORM log_activity(p_node_id, p_requester_email, 'AUTHORITY', v_authority_id::VARCHAR, p_old_role_name, 'updated', 'role', p_old_role_name, p_new_role_name);

    -- 8. 갱신된 권한 객체 및 할당 객체 반환
    RETURN QUERY 
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE authority_id = v_authority_id
    UNION ALL
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', r.assignment_id,
        'node_id', r.node_id,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = r.role_id),
        'role_id', r.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = r.role_id),
        'updated_at', r.updated_at
    )
    FROM role_assignments r
    JOIN users u ON r.user_id = u.user_id
    WHERE r.node_id = p_node_id AND r.role_id = p_role_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0407' OR SQLSTATE 'P0408' OR SQLSTATE 'P0409' OR SQLSTATE 'P0412' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0414]Failed to rename role : % to %, (REASON: %)', p_old_role_name, p_new_role_name, SQLERRM
            USING ERRCODE = 'P0414';
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 역할 회수(제거) 지원
-- ============================================================================

-- RoleController::get_role_removal_preview (역할 회수 사전 확인)
-- 회수 대상 사용자의 직속 역할, 이관해야 할 업무 목록, 이관 가능한 대상 목록을 반환한다.
CREATE OR REPLACE FUNCTION get_role_removal_preview(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_target_name users.name%TYPE;
    v_target_role role_authorities.role%TYPE;
    v_target_role_id role_authorities.authority_id%TYPE;
    v_is_top_role BOOLEAN;
    v_subtree_ids INTEGER[];
    v_path organization_nodes.path%TYPE;
    v_work_items JSONB;
    v_transfer_targets JSONB;
    v_work_item_count INTEGER;
    v_can_remove BOOLEAN;
    v_blocked_reason TEXT;
BEGIN
    -- 1. 요청자 / 대상 사용자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT user_id, name INTO v_target_id, v_target_name FROM users WHERE email = p_target_email AND is_deleted = FALSE;
    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Target user does not exist : %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 노드 확인
    SELECT path INTO v_path FROM organization_nodes WHERE node_id = p_node_id AND is_deleted = FALSE;
    IF v_path IS NULL THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted : %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자 권한 체크 (해당 노드에 직접 부여된 NODE_ADD_ROLE 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have direct authority to remove role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 대상이 해당 노드에 직속 역할을 보유해야 한다 (상속 멤버는 회수 대상이 아니다)
    SELECT a.role, a.authority_id, a.is_top_role
    INTO v_target_role, v_target_role_id, v_is_top_role
    FROM role_assignments r
    JOIN role_authorities a ON a.authority_id = r.role_id
    WHERE r.user_id = v_target_id AND r.node_id = p_node_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0403]Target user does not have a direct role on this node : %', p_target_email
        USING ERRCODE = 'P0403';
    END IF;

    -- 5. 이 노드의 하위 트리
    SELECT array_agg(node_id) INTO v_subtree_ids
    FROM organization_nodes
    WHERE p_node_id = ANY(path) AND is_deleted = FALSE;

    -- 6. 이관 대상 업무 (완료 업무는 그대로 두고, 미완료 업무만 이관한다)
    SELECT
        COALESCE(jsonb_agg(
            jsonb_build_object(
                'work_item_id', src.work_item_id,
                'title', CASE
                    WHEN src.hidden AND NOT check_authority_with_override(v_requester_id, src.owner_node_id, 'WI_HIDDEN_VIEW')
                        THEN '숨김 업무'
                    ELSE src.title
                END,
                'owner_node_id', src.owner_node_id,
                'owner_node_name', src.owner_node_name,
                'hidden', src.hidden,
                'status', src.status
            )
            ORDER BY src.due_date NULLS LAST, src.work_item_id
        ), '[]'::jsonb),
        COUNT(*)
    INTO v_work_items, v_work_item_count
    FROM (
        SELECT w.work_item_id, w.title, w.owner_node_id, w.hidden, w.status, w.due_date,
               n.name AS owner_node_name
        FROM work_items w
        LEFT JOIN organization_nodes n ON n.node_id = w.owner_node_id
        WHERE w.owner_user_id = v_target_id
          AND w.is_deleted = FALSE
          AND w.status <> 'done'
          AND w.owner_node_id = ANY(v_subtree_ids)
          AND get_authority_source_node(v_target_id, w.owner_node_id) = p_node_id
    ) src;

    -- 7. 이관 가능한 대상: 이 노드 스코프의 구성원 중, 이관 대상 업무 전부를 수행할 자격이 있는 사용자
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'user_id', c.user_id,
        'name', c.name,
        'email', c.email
    ) ORDER BY c.name), '[]'::jsonb)
    INTO v_transfer_targets
    FROM (
        SELECT DISTINCT u.user_id, u.name, u.email
        FROM users u
        WHERE u.is_deleted = FALSE
          AND u.user_id <> v_target_id
          AND EXISTS (
              SELECT 1 FROM role_assignments ra
              WHERE ra.user_id = u.user_id AND ra.node_id = ANY(v_path)
          )
          AND NOT EXISTS (
              SELECT 1
              FROM work_items w2
              WHERE w2.owner_user_id = v_target_id
                AND w2.is_deleted = FALSE
                AND w2.status <> 'done'
                AND w2.owner_node_id = ANY(v_subtree_ids)
                AND get_authority_source_node(v_target_id, w2.owner_node_id) = p_node_id
                AND (
                    NOT check_authority_with_override(u.user_id, w2.owner_node_id, 'WI_PERSONAL_CHANGE')
                    OR (w2.hidden AND NOT check_authority_with_override(u.user_id, w2.owner_node_id, 'WI_HIDDEN_CHANGE'))
                )
          )
    ) c;

    -- 8. 회수 가능 여부
    v_can_remove := TRUE;
    v_blocked_reason := NULL;

    IF v_is_top_role THEN
        v_can_remove := FALSE;
        v_blocked_reason := '최상위 담당자(ADMIN) 역할은 회수할 수 없습니다.';
    ELSIF v_target_id = v_requester_id THEN
        v_can_remove := FALSE;
        v_blocked_reason := '본인의 역할은 회수할 수 없습니다.';
    ELSIF v_work_item_count > 0 AND jsonb_array_length(v_transfer_targets) = 0 THEN
        v_can_remove := FALSE;
        v_blocked_reason := '이관해야 할 업무가 있지만 이관 가능한 대상이 없습니다. 먼저 이관 대상에게 업무 수행 권한을 부여해 주세요.';
    END IF;

    RETURN QUERY SELECT jsonb_build_object(
        'type', 'ROLE_REMOVAL_PREVIEW',
        'can_remove', v_can_remove,
        'blocked_reason', v_blocked_reason,
        'node_id', p_node_id,
        'target_user_id', v_target_id,
        'target_user_name', v_target_name,
        'target_user_email', p_target_email,
        'role_id', v_target_role_id,
        'role', v_target_role,
        'is_top_role', COALESCE(v_is_top_role, FALSE),
        'work_items', v_work_items,
        'transfer_targets', v_transfer_targets
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0102' OR SQLSTATE 'P0103' OR SQLSTATE 'P0403' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0418]Failed to load role removal preview : %, (REASON: %)', p_target_email, SQLERRM
            USING ERRCODE = 'P0418';
END;
$$ LANGUAGE plpgsql;


-- RoleController::remove_role (사용자 역할 회수)
-- 완료 업무는 그대로 두고, 미완료 업무는 지정한 담당자에게 이관한 뒤 역할 할당을 삭제한다.
-- 이관 대상이 하나라도 자격 미달이면 전체를 롤백한다.
CREATE OR REPLACE FUNCTION remove_role(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_new_owner_email users.email%TYPE DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_target_name users.name%TYPE;
    v_target_role role_authorities.role%TYPE;
    v_assignment_id role_assignments.assignment_id%TYPE;
    v_is_top_role BOOLEAN;
    v_new_owner_id users.user_id%TYPE;
    v_new_owner_name users.name%TYPE;
    v_path organization_nodes.path%TYPE;
    v_subtree_ids INTEGER[];
    v_item RECORD;
    v_block_item_id work_items.work_item_id%TYPE;
    v_block_node_id work_items.owner_node_id%TYPE;
    v_work_item_count INTEGER := 0;
    v_schedule_count INTEGER := 0;
BEGIN
    -- 1. 요청자 / 대상 사용자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT user_id, name INTO v_target_id, v_target_name FROM users WHERE email = p_target_email AND is_deleted = FALSE;
    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Target user does not exist : %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 노드 확인
    SELECT path INTO v_path FROM organization_nodes WHERE node_id = p_node_id AND is_deleted = FALSE;
    IF v_path IS NULL THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted : %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자 권한 체크 (해당 노드에 직접 부여된 NODE_ADD_ROLE 필요)
    IF NOT check_direct_authority(v_requester_id, p_node_id, 'NODE_ADD_ROLE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have direct authority to remove role on this node : %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 대상의 직속 역할 조회
    SELECT r.assignment_id, a.role, a.is_top_role
    INTO v_assignment_id, v_target_role, v_is_top_role
    FROM role_assignments r
    JOIN role_authorities a ON a.authority_id = r.role_id
    WHERE r.user_id = v_target_id AND r.node_id = p_node_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0403]Target user does not have a direct role on this node : %', p_target_email
        USING ERRCODE = 'P0403';
    END IF;

    -- 5. 최상위 담당자와 본인은 회수할 수 없다
    IF v_is_top_role THEN
        RAISE EXCEPTION '[P0404]Cannot remove the top role of a node : %', p_target_email
        USING ERRCODE = 'P0404';
    END IF;

    IF v_target_id = v_requester_id THEN
        RAISE EXCEPTION '[P0415]Requester cannot remove their own role : %', p_requester_email
        USING ERRCODE = 'P0415';
    END IF;

    -- 6. 이 노드의 하위 트리
    SELECT array_agg(node_id) INTO v_subtree_ids
    FROM organization_nodes
    WHERE p_node_id = ANY(path) AND is_deleted = FALSE;

    -- 7. 이관 대상 업무 수 확인
    SELECT COUNT(*) INTO v_work_item_count
    FROM work_items w
    WHERE w.owner_user_id = v_target_id
      AND w.is_deleted = FALSE
      AND w.status <> 'done'
      AND w.owner_node_id = ANY(v_subtree_ids)
      AND get_authority_source_node(v_target_id, w.owner_node_id) = p_node_id;

    IF v_work_item_count > 0 THEN
        -- 7-1. 이관 대상 지정 필수
        IF p_new_owner_email IS NULL OR TRIM(p_new_owner_email) = '' THEN
            RAISE EXCEPTION '[P0416]Transfer target is required for % work item(s) : %', v_work_item_count, p_target_email
            USING ERRCODE = 'P0416';
        END IF;

        SELECT user_id, name INTO v_new_owner_id, v_new_owner_name
        FROM users WHERE email = p_new_owner_email AND is_deleted = FALSE;

        IF v_new_owner_id IS NULL THEN
            RAISE EXCEPTION '[P0002]Transfer target user does not exist : %', p_new_owner_email
            USING ERRCODE = 'P0002';
        END IF;

        IF v_new_owner_id = v_target_id THEN
            RAISE EXCEPTION '[P0416]Cannot transfer work items to the removed user : %', p_new_owner_email
            USING ERRCODE = 'P0416';
        END IF;

        -- 7-2. 이관 대상이 모든 업무(숨김 포함)를 수행할 자격이 있는지 한 번 더 검증한다.
        SELECT w.work_item_id, w.owner_node_id
        INTO v_block_item_id, v_block_node_id
        FROM work_items w
        WHERE w.owner_user_id = v_target_id
          AND w.is_deleted = FALSE
          AND w.status <> 'done'
          AND w.owner_node_id = ANY(v_subtree_ids)
          AND get_authority_source_node(v_target_id, w.owner_node_id) = p_node_id
          AND (
              NOT check_authority_with_override(v_new_owner_id, w.owner_node_id, 'WI_PERSONAL_CHANGE')
              OR (w.hidden AND NOT check_authority_with_override(v_new_owner_id, w.owner_node_id, 'WI_HIDDEN_CHANGE'))
          )
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION '[P0416]Transfer target lacks authority for work item % on node % : %, %',
                v_block_item_id, v_block_node_id, p_new_owner_email, p_target_email
            USING ERRCODE = 'P0416';
        END IF;
    END IF;

    -- 8. 미완료 업무 이관 + 활동 로그
    FOR v_item IN
        SELECT w.work_item_id, w.title, w.owner_node_id
        FROM work_items w
        WHERE w.owner_user_id = v_target_id
          AND w.is_deleted = FALSE
          AND w.status <> 'done'
          AND w.owner_node_id = ANY(v_subtree_ids)
          AND get_authority_source_node(v_target_id, w.owner_node_id) = p_node_id
        ORDER BY w.work_item_id
    LOOP
        UPDATE work_items
        SET owner_user_id = v_new_owner_id
        WHERE work_item_id = v_item.work_item_id;

        PERFORM log_activity(
            v_item.owner_node_id,
            p_requester_email,
            'WORK_ITEM',
            v_item.work_item_id,
            v_item.title,
            'updated',
            'owner',
            v_target_name,
            v_new_owner_name
        );
    END LOOP;

    -- 9. 일정 담당자 정리 (담당자가 워크스페이스를 떠나면 담당자 미정으로 되돌린다)
    WITH affected AS (
        SELECT r.rule_id
        FROM recurring_rules r
        WHERE r.assignee_user_id = v_target_id
          AND r.is_deleted = FALSE
          AND r.owner_node_id = ANY(v_subtree_ids)
          AND get_authority_source_node(v_target_id, r.owner_node_id) = p_node_id
    )
    UPDATE recurring_rules
    SET assignee_user_id = NULL
    WHERE rule_id IN (SELECT rule_id FROM affected);

    GET DIAGNOSTICS v_schedule_count = ROW_COUNT;

    -- 10. 역할 회수 로그 (할당 삭제 전에 남겨야 대상 사용자가 알림을 받는다)
    PERFORM log_activity(p_node_id, p_requester_email, 'ROLE', v_assignment_id::VARCHAR, v_target_name, 'deleted', 'role', v_target_role, NULL);

    -- 11. 역할 할당 삭제
    DELETE FROM role_assignments
    WHERE user_id = v_target_id AND node_id = p_node_id;

    RETURN QUERY SELECT jsonb_build_object(
        'type', 'ROLE',
        'action', 'removed',
        'node_id', p_node_id,
        'user_id', v_target_id,
        'user_name', v_target_name,
        'email', p_target_email,
        'role', v_target_role,
        'transferred_work_item_count', v_work_item_count,
        'transfer_target_user_id', v_new_owner_id,
        'transfer_target_name', v_new_owner_name,
        'transfer_target_email', p_new_owner_email,
        'cleared_schedule_count', v_schedule_count
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0102' OR SQLSTATE 'P0103' OR SQLSTATE 'P0403'
          OR SQLSTATE 'P0404' OR SQLSTATE 'P0415' OR SQLSTATE 'P0416' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0417]Failed to remove role of user : %, (REASON: %)', p_target_email, SQLERRM
            USING ERRCODE = 'P0417';
END;
$$ LANGUAGE plpgsql;
