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
