-- 컨트롤러에서 사용될 role_assignments 관련 함수 생성

-- RoleController::add_role
CREATE OR REPLACE FUNCTION add_role(
    p_requester_email VARCHAR,
    p_target_email VARCHAR,
    p_node_id INTEGER,
    p_role_name VARCHAR
) RETURNS SETOF action_result AS $$
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
        RETURN QUERY SELECT 
            FALSE, 
            '대상 사용자를 찾을 수 없습니다.'::TEXT, 
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

    -- 2. 요청자의 현재 노드 권한 확인
    SELECT role INTO v_requester_role 
    FROM role_assignments 
    WHERE user_id = v_requester_id AND node_id = p_node_id;

    -- 3. 권한 체크 (ADMIN 또는 MANAGER만 타인에게 권한 부여 가능)
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

    -- 4. 이미 권한이 있는지 확인 (중복 방지)
    IF EXISTS (SELECT 1 FROM role_assignments WHERE user_id = v_target_id AND node_id = p_node_id) THEN
        RETURN QUERY SELECT 
            FALSE, 
            '해당 사용자는 이미 이 노드에 권한이 있습니다.'::TEXT, 
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

    -- 5. 권한 부여 실행
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_target_id, p_node_id, p_role_name)
    RETURNING assignment_id INTO v_new_id;

    RETURN QUERY SELECT 
        TRUE, 
        '성공적으로 권한이 부여되었습니다.'::TEXT, 
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
END;
$$ LANGUAGE plpgsql;