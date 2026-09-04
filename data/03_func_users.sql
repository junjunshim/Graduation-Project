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
    v_hashed_password TEXT;
BEGIN
    -- 0. 사용자 중복 체크
    IF EXISTS (SELECT 1 FROM users WHERE user_id = p_user_id) THEN
        RAISE EXCEPTION '[P0510] User ID already exists: %', p_user_id
        USING ERRCODE = 'P0510';
    END IF;

    IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
        RAISE EXCEPTION '[P0501] Email already exists: %', p_email
        USING ERRCODE = 'P0501';
    END IF;

    -- 0-1. 비밀번호 단방향 Bcrypt 솔팅 해시 암호화 (이미 해시된 문자열이 아니면 crypt 처리)
    IF p_password_hash LIKE '$2a$%' OR p_password_hash LIKE '$2b$%' THEN
        v_hashed_password := p_password_hash;
    ELSE
        v_hashed_password := crypt(p_password_hash, gen_salt('bf', 10));
    END IF;

    -- 1. 유저 생성
    INSERT INTO users (user_id, email, name, password_hash)
    VALUES (p_user_id, p_email, p_name, v_hashed_password);

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
        WHEN SQLSTATE 'P0501' OR SQLSTATE 'P0510' THEN
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
    v_is_match BOOLEAN;
BEGIN
    -- 1. 이메일 존재 여부 확인 및 패스워드 해시값 검증
    SELECT password_hash INTO v_user_password_hash
    FROM users
    WHERE email = p_email AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0503] Email not found: %', p_email
        USING ERRCODE = 'P0503';
    END IF;

    -- Bcrypt 해시 검증 (crypt(입력비번, 저장된해시) = 저장된해시) 또는 레거시 평문 일치 호환
    IF v_user_password_hash LIKE '$2a$%' OR v_user_password_hash LIKE '$2b$%' THEN
        v_is_match := (v_user_password_hash = crypt(p_password_hash, v_user_password_hash));
    ELSE
        v_is_match := (v_user_password_hash = p_password_hash);
    END IF;

    IF NOT v_is_match THEN
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


-- UserController::updateUser
CREATE OR REPLACE FUNCTION update_user(
    p_requester_email users.email%TYPE,
    p_target_email users.email%TYPE,
    p_name users.name%TYPE DEFAULT NULL,
    p_password_hash users.password_hash%TYPE DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_id users.user_id%TYPE;
    v_old_name users.name%TYPE;
    v_personal_node_id users.personal_node_id%TYPE;
BEGIN
    -- 1. 요청자 및 대상 유저 존재 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    SELECT user_id, name, personal_node_id INTO v_target_id, v_old_name, v_personal_node_id 
    FROM users WHERE email = p_target_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001] Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION '[P0002] Target user does not exist: %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 권한 검증: 본인 정보만 수정 가능
    IF v_requester_id <> v_target_id THEN
        RAISE EXCEPTION '[P0103] Insufficient permissions. Only the user themselves can update their account: %', p_target_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 유저 정보 갱신 (NULL이거나 빈값 전송 시 기존값 유지, 비밀번호는 crypt 처리)
    UPDATE users
    SET
        name = COALESCE(NULLIF(p_name, ''), name),
        password_hash = CASE 
            WHEN p_password_hash IS NOT NULL AND p_password_hash <> '' THEN
                CASE 
                    WHEN p_password_hash LIKE '$2a$%' OR p_password_hash LIKE '$2b$%' THEN p_password_hash
                    ELSE crypt(p_password_hash, gen_salt('bf', 10))
                END
            ELSE password_hash
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = v_target_id;

    -- 4. 활동 피드 기록 (이름이 바뀐 경우에만 기록)
    IF p_name IS NOT NULL AND p_name <> '' AND p_name <> v_old_name THEN
        IF v_personal_node_id IS NOT NULL THEN
            PERFORM log_activity(v_personal_node_id, p_requester_email, 'USER', v_target_id, p_name, 'updated', 'name', v_old_name, p_name);
        END IF;
    END IF;

    -- 5. 결과 반환 (비밀번호를 제외한 본인 최신 데이터 반환)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'USER',
        'id', u.user_id,
        'email', u.email,
        'name', u.name,
        'personal_node_id', u.personal_node_id,
        'created_at', u.created_at,
        'updated_at', u.updated_at
    )
    FROM users u
    WHERE u.user_id = v_target_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0508] Error occurred while updating user: %', SQLERRM
        USING ERRCODE = 'P0508';
END;
$$ LANGUAGE plpgsql;

-- UserController::readCommentMention
CREATE OR REPLACE FUNCTION read_comment_mention(
    p_requester_email users.email%TYPE,
    p_mention_id INT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_mention_id INT;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 멘션 존재 여부 확인 및 본인 것인지 소유권 대조
    SELECT mention_id INTO v_target_mention_id 
    FROM comment_mentions 
    WHERE mention_id = p_mention_id AND mentioned_user_id = v_requester_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Mention alert does not exist or not authorized: %', p_mention_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 멘션 읽음 처리 업데이트 (is_read: FALSE -> TRUE, updated_at이 트리거에 의해 자동 갱신됨)
    UPDATE comment_mentions
    SET is_read = TRUE
    WHERE mention_id = p_mention_id;

    -- 4. 갱신 결과 반환 (폴링 동기화 연동을 위해 갱신된 멘션 오브젝트 반환)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'MENTION',
        'id', m.mention_id,
        'comment_id', m.comment_id,
        'work_item_id', c.work_item_id,
        'message', u_author.name || '님이 댓글에서 회원님을 멘션했습니다.',
        'is_read', m.is_read,
        'created_at', m.created_at,
        'updated_at', m.updated_at
    )::jsonb AS out_data
    FROM comment_mentions m
    JOIN work_item_comments c ON m.comment_id = c.comment_id
    JOIN users u_author ON c.author_user_id = u_author.user_id
    WHERE m.mention_id = p_mention_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0509]Failed to read comment mention: %, (REASON: %)', p_mention_id, SQLERRM
            USING ERRCODE = 'P0509';
END;
$$ LANGUAGE plpgsql;
