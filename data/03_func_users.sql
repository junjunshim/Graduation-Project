-- 컨트롤러에서 사용될 users 관련 함수 생성

-- UserController::register_user
CREATE OR REPLACE FUNCTION register_user(
    p_user_id users.user_id%TYPE,
    p_email users.email%TYPE,
    p_name users.name%TYPE,
    p_password_hash users.password_hash%TYPE
) RETURNS BOOLEAN AS $$
DECLARE
    v_new_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 0. 사용자 중복 체크
    IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
        RAISE EXCEPTION '[P0501] Email already exists: %', p_email
        USING ERRCODE = 'P0501';
    END IF;

    -- 1. 유저 생성
    INSERT INTO users (user_id, email, name, password_hash)
    VALUES (p_user_id, p_email, p_name, p_password_hash);

    -- 2. 개인 전용 노드 생성
    INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
    VALUES (
        'USER',
        NULL,
        p_name || ' 개인공간',
        '{}'::INTEGER[]
    )
    RETURNING node_id INTO v_new_node_id;

    -- 3. 생성된 노드의 path 업데이트 (자기 자신을 포함)
    UPDATE organization_nodes 
    SET path = ARRAY[v_new_node_id] 
    WHERE node_id = v_new_node_id;

    -- 4. 생성된 노드 ID를 유저 테이블에 업데이트
    UPDATE users 
    SET personal_node_id = v_new_node_id 
    WHERE user_id = p_user_id;

    -- 5. 개인 노드에 대한 관리자(ADMIN) 권한 부여
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (p_user_id, v_new_node_id, 'ADMIN');

    -- 6. 개인 노드에 대한 기본 권한 설정
    PERFORM default_node_authority(v_new_node_id);

    -- 7. 성공적으로 사용자 등록 완료
    RETURN TRUE;

    EXCEPTION
        WHEN SQLSTATE 'P0501' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0502] Error occurred while registering user: %', SQLERRM
        USING ERRCODE = 'P0502';
END;
$$ LANGUAGE plpgsql;


-- AuthController::loginUser
CREATE OR REPLACE FUNCTION login_user (
    p_email users.email%TYPE,
    p_password_hash users.password_hash%TYPE,
    p_refresh_token user_refresh_tokens.refresh_token%TYPE,
    p_refresh_expiry user_refresh_tokens.expires_at%TYPE
) 
RETURNS BOOLEAN AS $$
DECLARE
    v_user_password_hash users.password_hash%TYPE;
BEGIN
    -- 1. 이메일 존재 여부 확인 및 패스워드 해시값 검증
    SELECT password_hash INTO v_user_password_hash
    FROM users
    WHERE email = p_email;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0503] Email not found: %', p_email
        USING ERRCODE = 'P0503';
    END IF;

    IF v_user_password_hash <> p_password_hash THEN
        RAISE EXCEPTION '[P0504] Incorrect password for email: %', p_email
        USING ERRCODE = 'P0504';
    END IF;

    -- 2. 로그인 성공 시 리프레시 토큰 저장 (업sert)
    INSERT INTO user_refresh_tokens (user_email, refresh_token, expires_at) 
    VALUES (p_email, p_refresh_token, p_refresh_expiry)
    ON CONFLICT (user_email) DO UPDATE SET
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at;
    
    RETURN TRUE;

    EXCEPTION
        WHEN SQLSTATE 'P0503' OR SQLSTATE 'P0504' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0505] Error occurred during login: %', SQLERRM
        USING ERRCODE = 'P0505';
END;
$$ LANGUAGE plpgsql;


-- UserController::deleteUser (Soft Delete)
CREATE OR REPLACE FUNCTION delete_user(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE
) 
RETURNS BOOLEAN AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_personal_node_id users.personal_node_id%TYPE;
    v_target_name users.name%TYPE;
BEGIN
    -- 1. 요청자 및 대상 유저 존재 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    SELECT user_id, personal_node_id, name INTO v_target_id, v_personal_node_id, v_target_name FROM users WHERE email = p_target_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001] Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002] Target user does not exist: %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 권한 검증: 본인 삭제(탈퇴)만 허용
    IF v_requester_id <> v_target_id THEN
        RAISE EXCEPTION '[P0103] Insufficient permissions. Only the user themselves can delete their account: %', p_target_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 대상 유저 소프트 딜리트 처리 (트리거가 동작하여 개인 노드 및 소속 업무도 자동 삭제됨)
    UPDATE users
    SET is_deleted = TRUE
    WHERE user_id = v_target_id;

    -- 4. 활동 피드 기록 (개인 공간 노드가 있으면 활동 기록 남김)
    IF v_personal_node_id IS NOT NULL THEN
        PERFORM log_activity(v_personal_node_id, p_requester_email, 'USER', v_target_id, v_target_name, 'deleted');
    END IF;

    RETURN TRUE;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0506] Error occurred while deleting user: %', SQLERRM
        USING ERRCODE = 'P0506';
END;
$$ LANGUAGE plpgsql;


-- UserController::getUserProfile (JSONB dynamic filter)
CREATE OR REPLACE FUNCTION get_user_profile(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_rec RECORD;
BEGIN
    -- 1. 요청자 식별
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001] Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 사용자 식별
    SELECT * INTO v_target_rec FROM users WHERE email = p_target_email AND is_deleted = FALSE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002] Target user does not exist: %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 본인 vs 타인 분기 반환
    IF v_requester_id = v_target_rec.user_id THEN
        -- [본인 조회]: 비밀번호를 제외한 유저의 모든 상세 정보 노출 (향후 테이블 속성이 늘어날 때 여기에만 추가해주면 끝)
        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'USER',
            'id', v_target_rec.user_id,
            'email', v_target_rec.email,
            'name', v_target_rec.name,
            'personal_node_id', v_target_rec.personal_node_id,
            'created_at', v_target_rec.created_at,
            'updated_at', v_target_rec.updated_at
        );
    ELSE
        -- [남의 정보 조회]: 개인 정보 보호를 위해 제한적으로 이메일과 이름만 반환
        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'USER',
            'email', v_target_rec.email,
            'name', v_target_rec.name
        );
    END IF;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0507] Error occurred while fetching user profile: %', SQLERRM
        USING ERRCODE = 'P0507';
END;
$$ LANGUAGE plpgsql;
