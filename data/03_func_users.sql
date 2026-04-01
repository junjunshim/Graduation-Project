-- 컨트롤러에서 사용될 users 관련 함수 생성

-- UserController::register_user
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


-- AuthController::loginUser
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
