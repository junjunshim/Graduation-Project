-- 컨트롤러 및 PL/pgSQL 함수에서 최근 활동 피드 생성을 위해 사용될 공통 로깅 함수

CREATE OR REPLACE FUNCTION log_activity(
    p_node_id organization_nodes.node_id%TYPE,
    p_actor_email users.email%TYPE,
    p_entity_type VARCHAR(20),
    p_entity_id VARCHAR(50),
    p_target_name VARCHAR(200),
    p_action_type VARCHAR(20),
    p_field_name VARCHAR(50) DEFAULT NULL,
    p_old_value TEXT DEFAULT NULL,
    p_new_value TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    v_actor_id users.user_id%TYPE;
    v_actor_name users.name%TYPE;
BEGIN
    -- 1. 행위를 유발한 수행자(Actor) ID 및 실시간 이름 조회
    SELECT user_id, name INTO v_actor_id, v_actor_name 
    FROM users 
    WHERE email = p_actor_email;
    
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Actor user not found for email: %', p_actor_email;
    END IF;

    -- 2. 활동 로그 기록 (캐시된 수행자명 및 대상명과 함께 기록)
    INSERT INTO activity_logs (
        node_id,
        actor_user_id,
        actor_name,
        entity_type,
        entity_id,
        target_name,
        action_type,
        field_name,
        old_value,
        new_value
    ) VALUES (
        p_node_id,
        v_actor_id,
        v_actor_name,
        p_entity_type,
        p_entity_id,
        p_target_name,
        p_action_type,
        p_field_name,
        p_old_value,
        p_new_value
    );
END;
$$ LANGUAGE plpgsql;


-- Activity Timeline 통합 조회 함수
CREATE OR REPLACE FUNCTION get_activities(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE DEFAULT NULL,
    p_target_email users.email%TYPE DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_target_user_id users.user_id%TYPE;
    v_personal_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 0. 입력값 널(NULL) 치환 보정
    IF p_node_id = -1 THEN
        p_node_id := NULL;
    END IF;
    IF p_target_email = '' THEN
        p_target_email := NULL;
    END IF;

    -- 0. 예외 처리: 둘 다 NULL인 경우 차단
    IF p_node_id IS NULL AND p_target_email IS NULL THEN
        RAISE EXCEPTION '[P0701]At least one query filter (node_id or target_email) must be provided.'
        USING ERRCODE = 'P0701';
    END IF;

    -- 1. 요청자 식별
    SELECT user_id, personal_node_id INTO v_requester_id, v_personal_node_id 
    FROM users 
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 사용자 식별 (입력되었을 경우)
    IF p_target_email IS NOT NULL AND p_target_email <> '' THEN
        SELECT user_id INTO v_target_user_id 
        FROM users 
        WHERE email = p_target_email AND is_deleted = FALSE;

        IF v_target_user_id IS NULL THEN
            RAISE EXCEPTION '[P0002]Target user does not exist: %', p_target_email
            USING ERRCODE = 'P0002';
        END IF;
    END IF;

    -- 3. 조건별 분기 조회 및 권한 체크
    -- CASE A: 특정 노드의 활동 로그 조회 (p_target_email IS NULL)
    IF p_node_id IS NOT NULL AND v_target_user_id IS NULL THEN
        -- 요청자가 해당 노드의 모든 히스토리 조회 권한(HISTORY_ALL_VIEW)을 가지고 있는지 체크
        IF NOT check_authority_with_override(v_requester_id, p_node_id, 'HISTORY_ALL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient authority. HISTORY_ALL_VIEW is required on node: %', p_node_id
            USING ERRCODE = 'P0103';
        END IF;

        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'ACTIVITY',
            'id', al.log_id,
            'node_id', al.node_id,
            'actor_user_id', al.actor_user_id,
            'actor_name', al.actor_name,
            'entity_type', al.entity_type,
            'entity_id', al.entity_id,
            'target_name', al.target_name,
            'action_type', al.action_type,
            'field_name', al.field_name,
            'old_value', al.old_value,
            'new_value', al.new_value,
            'created_at', al.created_at
        )
        FROM activity_logs al
        WHERE al.node_id = p_node_id
        ORDER BY al.created_at DESC;

    -- CASE B: 특정 노드 내부 + 특정 사용자가 수행한 활동 조회
    ELSIF p_node_id IS NOT NULL AND v_target_user_id IS NOT NULL THEN
        -- 요청자가 해당 노드의 HISTORY_ALL_VIEW 권한을 가져야 함
        IF NOT check_authority_with_override(v_requester_id, p_node_id, 'HISTORY_ALL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient authority. HISTORY_ALL_VIEW is required on node: %', p_node_id
            USING ERRCODE = 'P0103';
        END IF;

        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'ACTIVITY',
            'id', al.log_id,
            'node_id', al.node_id,
            'actor_user_id', al.actor_user_id,
            'actor_name', al.actor_name,
            'entity_type', al.entity_type,
            'entity_id', al.entity_id,
            'target_name', al.target_name,
            'action_type', al.action_type,
            'field_name', al.field_name,
            'old_value', al.old_value,
            'new_value', al.new_value,
            'created_at', al.created_at
        )
        FROM activity_logs al
        WHERE al.node_id = p_node_id 
          AND al.actor_user_id = v_target_user_id
        ORDER BY al.created_at DESC;

    -- CASE C: 특정 사용자(본인 또는 타인)의 전체 노드 활동 조회 (p_node_id IS NULL)
    ELSIF p_node_id IS NULL AND v_target_user_id IS NOT NULL THEN
        -- C-1: 본인 조회인 경우
        IF v_requester_id = v_target_user_id THEN
            -- HISTORY_PERSONAL_VIEW 권한 보유 체크
            IF NOT check_authority_with_override(v_requester_id, v_personal_node_id, 'HISTORY_PERSONAL_VIEW') THEN
                RAISE EXCEPTION '[P0103]Insufficient authority. HISTORY_PERSONAL_VIEW is required.'
                USING ERRCODE = 'P0103';
            END IF;

            RETURN QUERY
            SELECT jsonb_build_object(
                'type', 'ACTIVITY',
                'id', al.log_id,
                'node_id', al.node_id,
                'actor_user_id', al.actor_user_id,
                'actor_name', al.actor_name,
                'entity_type', al.entity_type,
                'entity_id', al.entity_id,
                'target_name', al.target_name,
                'action_type', al.action_type,
                'field_name', al.field_name,
                'old_value', al.old_value,
                'new_value', al.new_value,
                'created_at', al.created_at
            )
            FROM activity_logs al
            WHERE al.actor_user_id = v_requester_id
            ORDER BY al.created_at DESC;
        
        -- C-2: 타인 조회인 경우
        ELSE
            -- 요청자가 HISTORY_ALL_VIEW 권한을 갖고 있는 노드들 하위에 소속된 활동만 필터링하여 출력
            RETURN QUERY
            SELECT jsonb_build_object(
                'type', 'ACTIVITY',
                'id', al.log_id,
                'node_id', al.node_id,
                'actor_user_id', al.actor_user_id,
                'actor_name', al.actor_name,
                'entity_type', al.entity_type,
                'entity_id', al.entity_id,
                'target_name', al.target_name,
                'action_type', al.action_type,
                'field_name', al.field_name,
                'old_value', al.old_value,
                'new_value', al.new_value,
                'created_at', al.created_at
            )
            FROM activity_logs al
            WHERE al.actor_user_id = v_target_user_id
              AND EXISTS (
                  SELECT 1 
                  FROM role_assignments ra
                  WHERE ra.user_id = v_requester_id
                    AND check_authority_with_override(v_requester_id, ra.node_id, 'HISTORY_ALL_VIEW')
                    AND (
                        -- 해당 로그가 켜진 노드가 권한 보유 노드이거나 그 하위 노드인 경우
                        al.node_id = ra.node_id
                        OR EXISTS (
                            SELECT 1 FROM organization_nodes child
                            WHERE child.node_id = al.node_id
                              AND ra.node_id = ANY(child.path)
                        )
                    )
              )
            ORDER BY al.created_at DESC;
        END IF;
    END IF;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0701' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0702]Failed to fetch activities (REASON: %)', SQLERRM
        USING ERRCODE = 'P0702';
END;
$$ LANGUAGE plpgsql;
