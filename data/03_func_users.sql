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
