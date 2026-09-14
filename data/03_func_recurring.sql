-- 정기/반복 일정 및 루틴 업무 관리 함수 (data/03_func_recurring.sql)

-- 1. create_recurring_rule
-- 정기 일정 규칙 및 체크리스트 템플릿 생성
CREATE OR REPLACE FUNCTION create_recurring_rule(
    p_requester_email users.email%TYPE,
    p_owner_node_id organization_nodes.node_id%TYPE,
    p_assignee_user_email users.email%TYPE,
    p_title recurring_rules.title%TYPE,
    p_description recurring_rules.description%TYPE DEFAULT NULL,
    p_category recurring_rules.category%TYPE DEFAULT 'ROUTINE',
    p_frequency recurring_rules.frequency%TYPE DEFAULT 'DAILY',
    p_interval_value recurring_rules.interval_value%TYPE DEFAULT 1,
    p_by_day recurring_rules.by_day%TYPE DEFAULT NULL,
    p_by_month_day recurring_rules.by_month_day%TYPE DEFAULT NULL,
    p_by_set_pos recurring_rules.by_set_pos%TYPE DEFAULT NULL,
    p_start_time VARCHAR DEFAULT NULL,
    p_duration_minutes recurring_rules.duration_minutes%TYPE DEFAULT 60,
    p_repeat_start_date VARCHAR DEFAULT NULL,
    p_repeat_end_date VARCHAR DEFAULT NULL,
    p_max_occurrences recurring_rules.max_occurrences%TYPE DEFAULT NULL,
    p_exclude_holidays recurring_rules.exclude_holidays%TYPE DEFAULT TRUE,
    p_holiday_action recurring_rules.holiday_action%TYPE DEFAULT 'SKIP',
    p_auto_create_task recurring_rules.auto_create_task%TYPE DEFAULT FALSE,
    p_checklists JSONB DEFAULT '[]'::jsonb
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_assignee_id users.user_id%TYPE := NULL;
    v_new_rule_id INTEGER;
    v_item JSONB;
    v_sort_order INTEGER := 0;
BEGIN
    -- 1. 요청자 조회
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 생존 및 권한 확인 (WI_PERSONAL_CHANGE 권한 필요)
    IF NOT EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = p_owner_node_id AND is_deleted = FALSE) THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted: %', p_owner_node_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT check_authority_with_override(v_requester_id, p_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', p_owner_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 담당자 이메일 확인 (선택)
    IF p_assignee_user_email IS NOT NULL AND p_assignee_user_email <> '' THEN
        SELECT user_id INTO v_assignee_id FROM users WHERE email = p_assignee_user_email AND is_deleted = FALSE;
        IF v_assignee_id IS NULL THEN
            RAISE EXCEPTION '[P0002]Assignee user does not exist: %', p_assignee_user_email
            USING ERRCODE = 'P0002';
        END IF;
    END IF;

    -- 4. 정기 일정 삽입
    INSERT INTO recurring_rules (
        owner_node_id,
        creator_user_id,
        assignee_user_id,
        title,
        description,
        category,
        frequency,
        interval_value,
        by_day,
        by_month_day,
        by_set_pos,
        start_time,
        duration_minutes,
        repeat_start_date,
        repeat_end_date,
        max_occurrences,
        exclude_holidays,
        holiday_action,
        auto_create_task
    ) VALUES (
        p_owner_node_id,
        v_requester_id,
        v_assignee_id,
        p_title,
        NULLIF(p_description, ''),
        COALESCE(NULLIF(p_category, ''), 'ROUTINE'),
        COALESCE(NULLIF(p_frequency, ''), 'DAILY'),
        COALESCE(p_interval_value, 1),
        NULLIF(p_by_day, ''),
        p_by_month_day,
        p_by_set_pos,
        NULLIF(p_start_time, '')::TIME,
        COALESCE(p_duration_minutes, 60),
        COALESCE(NULLIF(p_repeat_start_date, '')::DATE, CURRENT_DATE),
        NULLIF(p_repeat_end_date, '')::DATE,
        p_max_occurrences,
        COALESCE(p_exclude_holidays, TRUE),
        COALESCE(NULLIF(p_holiday_action, ''), 'SKIP'),
        COALESCE(p_auto_create_task, FALSE)
    ) RETURNING rule_id INTO v_new_rule_id;

    -- 5. 체크리스트 일괄 등록
    IF p_checklists IS NOT NULL AND jsonb_array_length(p_checklists) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_array_elements(p_checklists)
        LOOP
            IF (v_item->>'content') IS NOT NULL AND trim(v_item->>'content') <> '' THEN
                INSERT INTO recurring_rule_checklists (
                    rule_id,
                    content,
                    sort_order
                ) VALUES (
                    v_new_rule_id,
                    trim(v_item->>'content'),
                    COALESCE((v_item->>'sort_order')::INTEGER, v_sort_order)
                );
                v_sort_order := v_sort_order + 1;
            END IF;
        END LOOP;
    END IF;

    -- 6. 활동 로그 기록
    PERFORM log_activity(p_owner_node_id, p_requester_email, 'RECURRING_RULE', v_new_rule_id::VARCHAR, p_title, 'inserted');

    -- 7. 생성된 단일 규칙 통합 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE',
        'rule_id', r.rule_id,
        'owner_node_id', r.owner_node_id,
        'creator_user_id', r.creator_user_id,
        'creator_email', u_creator.email,
        'creator_name', u_creator.name,
        'assignee_user_id', r.assignee_user_id,
        'assignee_email', u_assignee.email,
        'assignee_name', u_assignee.name,
        'title', r.title,
        'description', r.description,
        'category', r.category,
        'frequency', r.frequency,
        'interval_value', r.interval_value,
        'by_day', r.by_day,
        'by_month_day', r.by_month_day,
        'by_set_pos', r.by_set_pos,
        'start_time', r.start_time,
        'duration_minutes', r.duration_minutes,
        'repeat_start_date', r.repeat_start_date,
        'repeat_end_date', r.repeat_end_date,
        'max_occurrences', r.max_occurrences,
        'exclude_holidays', r.exclude_holidays,
        'holiday_action', r.holiday_action,
        'auto_create_task', r.auto_create_task,
        'is_active', r.is_active,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'checklists', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'checklist_id', c.checklist_id,
                        'content', c.content,
                        'sort_order', c.sort_order,
                        'created_at', c.created_at
                    ) ORDER BY c.sort_order ASC, c.checklist_id ASC
                )
                FROM recurring_rule_checklists c
                WHERE c.rule_id = r.rule_id
            ), '[]'::jsonb
        ),
        'files', '[]'::jsonb
    )::jsonb AS out_data
    FROM recurring_rules r
    JOIN users u_creator ON r.creator_user_id = u_creator.user_id
    LEFT JOIN users u_assignee ON r.assignee_user_id = u_assignee.user_id
    WHERE r.rule_id = v_new_rule_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0602]Failed to create recurring rule: %, (REASON: %)', p_title, SQLERRM
            USING ERRCODE = 'P0602';
END;
$$ LANGUAGE plpgsql;


-- 2. get_recurring_rules
-- 특정 노드의 활성 정기 일정 목록 및 하위 체크리스트, 파일 메타데이터 통합 반환
CREATE OR REPLACE FUNCTION get_recurring_rules(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_include_deleted BOOLEAN DEFAULT FALSE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
BEGIN
    -- 1. 요청자 조회
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 생존 및 권한 확인 (NODE_INFO_VIEW 및 WI_PUBLIC_VIEW)
    IF NOT EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = p_node_id AND (is_deleted = FALSE OR p_include_deleted = TRUE)) THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 정기 일정 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE',
        'rule_id', r.rule_id,
        'owner_node_id', r.owner_node_id,
        'creator_user_id', r.creator_user_id,
        'creator_email', u_creator.email,
        'creator_name', u_creator.name,
        'assignee_user_id', r.assignee_user_id,
        'assignee_email', u_assignee.email,
        'assignee_name', u_assignee.name,
        'title', r.title,
        'description', r.description,
        'category', r.category,
        'frequency', r.frequency,
        'interval_value', r.interval_value,
        'by_day', r.by_day,
        'by_month_day', r.by_month_day,
        'by_set_pos', r.by_set_pos,
        'start_time', r.start_time,
        'duration_minutes', r.duration_minutes,
        'repeat_start_date', r.repeat_start_date,
        'repeat_end_date', r.repeat_end_date,
        'max_occurrences', r.max_occurrences,
        'exclude_holidays', r.exclude_holidays,
        'holiday_action', r.holiday_action,
        'auto_create_task', r.auto_create_task,
        'is_active', r.is_active,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'checklists', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'checklist_id', c.checklist_id,
                        'content', c.content,
                        'sort_order', c.sort_order,
                        'created_at', c.created_at
                    ) ORDER BY c.sort_order ASC, c.checklist_id ASC
                )
                FROM recurring_rule_checklists c
                WHERE c.rule_id = r.rule_id
            ), '[]'::jsonb
        ),
        'files', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'file_id', f.file_id,
                        'rule_id', f.rule_id,
                        'uploader_user_id', f.uploader_user_id,
                        'uploader_email', u_uploader.email,
                        'uploader_name', u_uploader.name,
                        'original_file_name', f.original_file_name,
                        'file_size', f.file_size,
                        'mime_type', f.mime_type,
                        'is_deleted', f.is_deleted,
                        'created_at', f.created_at
                    ) ORDER BY f.created_at ASC
                )
                FROM recurring_rule_files f
                JOIN users u_uploader ON f.uploader_user_id = u_uploader.user_id
                WHERE f.rule_id = r.rule_id AND (p_include_deleted = TRUE OR f.is_deleted = FALSE)
            ), '[]'::jsonb
        )
    )::jsonb AS out_data
    FROM recurring_rules r
    JOIN users u_creator ON r.creator_user_id = u_creator.user_id
    LEFT JOIN users u_assignee ON r.assignee_user_id = u_assignee.user_id
    WHERE r.owner_node_id = p_node_id
      AND (p_include_deleted = TRUE OR r.is_deleted = FALSE)
    ORDER BY r.created_at DESC;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0609]Failed to fetch recurring rules: %, (REASON: %)', p_node_id, SQLERRM
            USING ERRCODE = 'P0609';
END;
$$ LANGUAGE plpgsql;


-- 2.1 get_recurring_rule_detail
-- 특정 단일 정기 일정 상세 조회
CREATE OR REPLACE FUNCTION get_recurring_rule_detail(
    p_requester_email users.email%TYPE,
    p_rule_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT owner_node_id INTO v_owner_node_id FROM recurring_rules WHERE rule_id = p_rule_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Recurring rule does not exist: %', p_rule_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', v_owner_node_id
        USING ERRCODE = 'P0103';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE',
        'rule_id', r.rule_id,
        'owner_node_id', r.owner_node_id,
        'creator_user_id', r.creator_user_id,
        'creator_email', u_creator.email,
        'creator_name', u_creator.name,
        'assignee_user_id', r.assignee_user_id,
        'assignee_email', u_assignee.email,
        'assignee_name', u_assignee.name,
        'title', r.title,
        'description', r.description,
        'category', r.category,
        'frequency', r.frequency,
        'interval_value', r.interval_value,
        'by_day', r.by_day,
        'by_month_day', r.by_month_day,
        'by_set_pos', r.by_set_pos,
        'start_time', r.start_time,
        'duration_minutes', r.duration_minutes,
        'repeat_start_date', r.repeat_start_date,
        'repeat_end_date', r.repeat_end_date,
        'max_occurrences', r.max_occurrences,
        'exclude_holidays', r.exclude_holidays,
        'holiday_action', r.holiday_action,
        'auto_create_task', r.auto_create_task,
        'is_active', r.is_active,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at,
        'checklists', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'checklist_id', c.checklist_id,
                        'content', c.content,
                        'sort_order', c.sort_order,
                        'created_at', c.created_at
                    ) ORDER BY c.sort_order ASC, c.checklist_id ASC
                )
                FROM recurring_rule_checklists c
                WHERE c.rule_id = r.rule_id
            ), '[]'::jsonb
        ),
        'files', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'file_id', f.file_id,
                        'rule_id', f.rule_id,
                        'uploader_user_id', f.uploader_user_id,
                        'uploader_email', u_uploader.email,
                        'uploader_name', u_uploader.name,
                        'original_file_name', f.original_file_name,
                        'file_size', f.file_size,
                        'mime_type', f.mime_type,
                        'is_deleted', f.is_deleted,
                        'created_at', f.created_at
                    ) ORDER BY f.created_at ASC
                )
                FROM recurring_rule_files f
                JOIN users u_uploader ON f.uploader_user_id = u_uploader.user_id
                WHERE f.rule_id = r.rule_id
            ), '[]'::jsonb
        )
    )::jsonb AS out_data
    FROM recurring_rules r
    JOIN users u_creator ON r.creator_user_id = u_creator.user_id
    LEFT JOIN users u_assignee ON r.assignee_user_id = u_assignee.user_id
    WHERE r.rule_id = p_rule_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0609]Failed to fetch recurring rule detail: %, (REASON: %)', p_rule_id, SQLERRM
            USING ERRCODE = 'P0609';
END;
$$ LANGUAGE plpgsql;


-- 3. update_recurring_rule
-- 규칙 수정 및 체크리스트 갱신
CREATE OR REPLACE FUNCTION update_recurring_rule(
    p_requester_email users.email%TYPE,
    p_rule_id INTEGER,
    p_assignee_user_email users.email%TYPE DEFAULT NULL,
    p_title recurring_rules.title%TYPE DEFAULT NULL,
    p_description recurring_rules.description%TYPE DEFAULT NULL,
    p_category recurring_rules.category%TYPE DEFAULT NULL,
    p_frequency recurring_rules.frequency%TYPE DEFAULT NULL,
    p_interval_value recurring_rules.interval_value%TYPE DEFAULT NULL,
    p_by_day recurring_rules.by_day%TYPE DEFAULT NULL,
    p_by_month_day recurring_rules.by_month_day%TYPE DEFAULT NULL,
    p_by_set_pos recurring_rules.by_set_pos%TYPE DEFAULT NULL,
    p_start_time VARCHAR DEFAULT NULL,
    p_duration_minutes recurring_rules.duration_minutes%TYPE DEFAULT NULL,
    p_repeat_start_date VARCHAR DEFAULT NULL,
    p_repeat_end_date VARCHAR DEFAULT NULL,
    p_max_occurrences recurring_rules.max_occurrences%TYPE DEFAULT NULL,
    p_exclude_holidays recurring_rules.exclude_holidays%TYPE DEFAULT NULL,
    p_holiday_action recurring_rules.holiday_action%TYPE DEFAULT NULL,
    p_auto_create_task recurring_rules.auto_create_task%TYPE DEFAULT NULL,
    p_is_active recurring_rules.is_active%TYPE DEFAULT NULL,
    p_checklists JSONB DEFAULT NULL -- NULL이면 체크리스트 변경 안 함, 배열이면 갱신
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_creator_user_id users.user_id%TYPE;
    v_current_assignee_id users.user_id%TYPE;
    v_target_assignee_id users.user_id%TYPE;
    v_old_title recurring_rules.title%TYPE;
    v_item JSONB;
    v_sort_order INTEGER := 0;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 기존 규칙 정보 조회
    SELECT owner_node_id, creator_user_id, assignee_user_id, title
    INTO v_owner_node_id, v_creator_user_id, v_current_assignee_id, v_old_title
    FROM recurring_rules
    WHERE rule_id = p_rule_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Recurring rule does not exist or is deleted: %', p_rule_id
        USING ERRCODE = 'P0603';
    END IF;

    -- 3. 권한 체크 (작성자/담당자이거나 노드의 WI_PERSONAL_CHANGE / WI_OTHERS_CHANGE 권한 보유)
    IF v_creator_user_id <> v_requester_id AND (v_current_assignee_id IS NULL OR v_current_assignee_id <> v_requester_id) THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to modify recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to modify recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 담당자 이메일 처리
    v_target_assignee_id := v_current_assignee_id;
    IF p_assignee_user_email IS NOT NULL THEN
        IF p_assignee_user_email = '' THEN
            v_target_assignee_id := NULL;
        ELSE
            SELECT user_id INTO v_target_assignee_id FROM users WHERE email = p_assignee_user_email AND is_deleted = FALSE;
            IF v_target_assignee_id IS NULL THEN
                RAISE EXCEPTION '[P0002]Assignee user does not exist: %', p_assignee_user_email
                USING ERRCODE = 'P0002';
            END IF;
        END IF;
    END IF;

    -- 5. 규칙 정보 업데이트
    UPDATE recurring_rules
    SET
        assignee_user_id = v_target_assignee_id,
        title = COALESCE(NULLIF(p_title, ''), title),
        description = CASE WHEN p_description IS NOT NULL THEN NULLIF(p_description, '') ELSE description END,
        category = COALESCE(NULLIF(p_category, ''), category),
        frequency = COALESCE(NULLIF(p_frequency, ''), frequency),
        interval_value = COALESCE(p_interval_value, interval_value),
        by_day = CASE WHEN p_by_day IS NOT NULL THEN NULLIF(p_by_day, '') ELSE by_day END,
        by_month_day = CASE WHEN p_by_month_day IS NOT NULL THEN p_by_month_day ELSE by_month_day END,
        by_set_pos = CASE WHEN p_by_set_pos IS NOT NULL THEN p_by_set_pos ELSE by_set_pos END,
        start_time = CASE WHEN p_start_time IS NOT NULL THEN NULLIF(p_start_time, '')::TIME ELSE start_time END,
        duration_minutes = COALESCE(p_duration_minutes, duration_minutes),
        repeat_start_date = CASE WHEN p_repeat_start_date IS NOT NULL THEN NULLIF(p_repeat_start_date, '')::DATE ELSE repeat_start_date END,
        repeat_end_date = CASE WHEN p_repeat_end_date IS NOT NULL THEN NULLIF(p_repeat_end_date, '')::DATE ELSE repeat_end_date END,
        max_occurrences = CASE WHEN p_max_occurrences IS NOT NULL THEN p_max_occurrences ELSE max_occurrences END,
        exclude_holidays = COALESCE(p_exclude_holidays, exclude_holidays),
        holiday_action = COALESCE(NULLIF(p_holiday_action, ''), holiday_action),
        auto_create_task = COALESCE(p_auto_create_task, auto_create_task),
        is_active = COALESCE(p_is_active, is_active)
    WHERE rule_id = p_rule_id;

    -- 6. 체크리스트 갱신 (배열이 전달된 경우 기존 항목 교체)
    IF p_checklists IS NOT NULL THEN
        DELETE FROM recurring_rule_checklists WHERE rule_id = p_rule_id;
        IF jsonb_array_length(p_checklists) > 0 THEN
            FOR v_item IN SELECT * FROM jsonb_array_elements(p_checklists)
            LOOP
                IF (v_item->>'content') IS NOT NULL AND trim(v_item->>'content') <> '' THEN
                    INSERT INTO recurring_rule_checklists (
                        rule_id,
                        content,
                        sort_order
                    ) VALUES (
                        p_rule_id,
                        trim(v_item->>'content'),
                        COALESCE((v_item->>'sort_order')::INTEGER, v_sort_order)
                    );
                    v_sort_order := v_sort_order + 1;
                END IF;
            END LOOP;
        END IF;
    END IF;

    -- 7. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'RECURRING_RULE', p_rule_id::VARCHAR, COALESCE(p_title, v_old_title), 'updated');

    -- 8. 갱신된 단일 규칙 통합 반환
    RETURN QUERY
    SELECT * FROM get_recurring_rule_detail(p_requester_email, p_rule_id);

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0603' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0604]Failed to update recurring rule: %, (REASON: %)', p_rule_id, SQLERRM
            USING ERRCODE = 'P0604';
END;
$$ LANGUAGE plpgsql;


-- 4. delete_recurring_rule
-- 소프트 딜리트 처리
CREATE OR REPLACE FUNCTION delete_recurring_rule(
    p_requester_email users.email%TYPE,
    p_rule_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_creator_user_id users.user_id%TYPE;
    v_assignee_user_id users.user_id%TYPE;
    v_title recurring_rules.title%TYPE;
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT owner_node_id, creator_user_id, assignee_user_id, title
    INTO v_owner_node_id, v_creator_user_id, v_assignee_user_id, v_title
    FROM recurring_rules
    WHERE rule_id = p_rule_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Recurring rule does not exist or already deleted: %', p_rule_id
        USING ERRCODE = 'P0603';
    END IF;

    IF v_creator_user_id <> v_requester_id AND (v_assignee_user_id IS NULL OR v_assignee_user_id <> v_requester_id) THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 소프트 딜리트
    UPDATE recurring_rules
    SET is_deleted = TRUE
    WHERE rule_id = p_rule_id;

    UPDATE recurring_rule_files
    SET is_deleted = TRUE
    WHERE rule_id = p_rule_id AND is_deleted = FALSE;

    PERFORM log_activity(v_owner_node_id, p_requester_email, 'RECURRING_RULE', p_rule_id::VARCHAR, v_title, 'deleted');

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE',
        'rule_id', p_rule_id,
        'owner_node_id', v_owner_node_id,
        'is_deleted', TRUE
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0603' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0605]Failed to delete recurring rule: %, (REASON: %)', p_rule_id, SQLERRM
            USING ERRCODE = 'P0605';
END;
$$ LANGUAGE plpgsql;


-- 5. restore_recurring_rule
-- 휴지통 복구 처리
CREATE OR REPLACE FUNCTION restore_recurring_rule(
    p_requester_email users.email%TYPE,
    p_rule_id INTEGER,
    p_cascade BOOLEAN DEFAULT FALSE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_creator_user_id users.user_id%TYPE;
    v_assignee_user_id users.user_id%TYPE;
    v_title recurring_rules.title%TYPE;
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT owner_node_id, creator_user_id, assignee_user_id, title
    INTO v_owner_node_id, v_creator_user_id, v_assignee_user_id, v_title
    FROM recurring_rules
    WHERE rule_id = p_rule_id AND is_deleted = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Recurring rule does not exist in deleted items: %', p_rule_id
        USING ERRCODE = 'P0603';
    END IF;

    -- 소속 노드가 삭제 상태인지 확인
    IF EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = v_owner_node_id AND is_deleted = TRUE) THEN
        RAISE EXCEPTION '[P0614]Cannot restore recurring rule because its owner node is still deleted: %', v_owner_node_id
        USING ERRCODE = 'P0614';
    END IF;

    IF v_creator_user_id <> v_requester_id AND (v_assignee_user_id IS NULL OR v_assignee_user_id <> v_requester_id) THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    UPDATE recurring_rules
    SET is_deleted = FALSE
    WHERE rule_id = p_rule_id;

    IF p_cascade = TRUE THEN
        UPDATE recurring_rule_files
        SET is_deleted = FALSE
        WHERE rule_id = p_rule_id AND is_deleted = TRUE;
    END IF;

    PERFORM log_activity(v_owner_node_id, p_requester_email, 'RECURRING_RULE', p_rule_id::VARCHAR, v_title, 'restored');

    RETURN QUERY
    SELECT * FROM get_recurring_rule_detail(p_requester_email, p_rule_id);

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0603' OR SQLSTATE 'P0614' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0617]Failed to restore recurring rule: %, (REASON: %)', p_rule_id, SQLERRM
            USING ERRCODE = 'P0617';
END;
$$ LANGUAGE plpgsql;





-- 7. upload_recurring_rule_file
-- 정기 일정 전용 파일 등록
CREATE OR REPLACE FUNCTION upload_recurring_rule_file(
    p_requester_email users.email%TYPE,
    p_rule_id INTEGER,
    p_original_file_name VARCHAR(255),
    p_stored_file_name VARCHAR(255),
    p_file_path TEXT,
    p_file_size BIGINT,
    p_mime_type VARCHAR(100) DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_creator_user_id users.user_id%TYPE;
    v_assignee_user_id users.user_id%TYPE;
    v_new_file_id INTEGER;
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT owner_node_id, creator_user_id, assignee_user_id INTO v_owner_node_id, v_creator_user_id, v_assignee_user_id
    FROM recurring_rules WHERE rule_id = p_rule_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Recurring rule does not exist or is deleted: %', p_rule_id
        USING ERRCODE = 'P0603';
    END IF;

    -- 파일 변경 권한(FILE_CHANGE) 검증
    IF v_creator_user_id <> v_requester_id AND (v_assignee_user_id IS NULL OR v_assignee_user_id <> v_requester_id) THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to upload file on this recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to upload file on this recurring rule: %', p_rule_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    INSERT INTO recurring_rule_files (
        rule_id,
        uploader_user_id,
        original_file_name,
        stored_file_name,
        file_path,
        file_size,
        mime_type
    ) VALUES (
        p_rule_id,
        v_requester_id,
        p_original_file_name,
        p_stored_file_name,
        p_file_path,
        p_file_size,
        p_mime_type
    ) RETURNING file_id INTO v_new_file_id;

    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', v_new_file_id::VARCHAR, 'Uploaded recurring file: ' || p_original_file_name, 'inserted');

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE_FILE',
        'file_id', f.file_id,
        'rule_id', f.rule_id,
        'uploader_user_id', f.uploader_user_id,
        'uploader_name', u.name,
        'uploader_email', u.email,
        'original_file_name', f.original_file_name,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'is_deleted', f.is_deleted,
        'created_at', f.created_at
    )::jsonb AS out_data
    FROM recurring_rule_files f
    JOIN users u ON f.uploader_user_id = u.user_id
    WHERE f.file_id = v_new_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0603' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0610]Failed to add recurring rule file: %, (REASON: %)', p_original_file_name, SQLERRM
            USING ERRCODE = 'P0610';
END;
$$ LANGUAGE plpgsql;


-- 8. delete_recurring_rule_file
-- 정기 일정 전용 파일 소프트 딜리트
CREATE OR REPLACE FUNCTION delete_recurring_rule_file(
    p_requester_email users.email%TYPE,
    p_file_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_uploader_user_id users.user_id%TYPE;
    v_rule_id INTEGER;
    v_original_file_name VARCHAR(255);
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT f.uploader_user_id, f.rule_id, f.original_file_name, r.owner_node_id
    INTO v_uploader_user_id, v_rule_id, v_original_file_name, v_owner_node_id
    FROM recurring_rule_files f
    JOIN recurring_rules r ON f.rule_id = r.rule_id
    WHERE f.file_id = p_file_id AND f.is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist or already deleted: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_uploader_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete file on this node: %', v_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    UPDATE recurring_rule_files
    SET is_deleted = TRUE
    WHERE file_id = p_file_id;

    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', p_file_id::VARCHAR, 'Deleted recurring file: ' || v_original_file_name, 'deleted');

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE_FILE',
        'file_id', p_file_id,
        'rule_id', v_rule_id,
        'is_deleted', TRUE
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0611]Failed to delete recurring rule file: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0611';
END;
$$ LANGUAGE plpgsql;


-- 8.1. restore_recurring_rule_file
-- 정기 일정 전용 파일 복구 처리
CREATE OR REPLACE FUNCTION restore_recurring_rule_file(
    p_requester_email users.email%TYPE,
    p_file_id INT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_uploader_user_id users.user_id%TYPE;
    v_rule_id INTEGER;
    v_original_file_name VARCHAR(255);
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 파일 확인 (삭제된 파일)
    SELECT f.uploader_user_id, f.rule_id, f.original_file_name, r.owner_node_id
    INTO v_uploader_user_id, v_rule_id, v_original_file_name, v_owner_node_id
    FROM recurring_rule_files f
    JOIN recurring_rules r ON f.rule_id = r.rule_id
    WHERE f.file_id = p_file_id AND f.is_deleted = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist in deleted items: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 상위 정기 일정이 여전히 삭제 상태인지 검증
    IF EXISTS (SELECT 1 FROM recurring_rules WHERE rule_id = v_rule_id AND is_deleted = TRUE) THEN
        RAISE EXCEPTION '[P0618]Cannot restore file because its recurring rule is still deleted. Rule ID: %', v_rule_id
        USING ERRCODE = 'P0618';
    END IF;

    -- 4. 권한 체크 (업로더 본인이거나 소속 노드의 FILE_CHANGE 권한 검증)
    IF v_uploader_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore file on this node. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 5. 복구 수행
    UPDATE recurring_rule_files
    SET is_deleted = FALSE
    WHERE file_id = p_file_id;

    -- 6. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', p_file_id::VARCHAR, 'Restored recurring file: ' || v_original_file_name, 'restored');

    -- 7. 결과 반환 (type: 'RECURRING_RULE_FILE')
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE_FILE',
        'file_id', f.file_id,
        'rule_id', f.rule_id,
        'uploader_user_id', f.uploader_user_id,
        'uploader_name', u.name,
        'uploader_email', u.email,
        'original_file_name', f.original_file_name,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'is_deleted', f.is_deleted,
        'created_at', f.created_at,
        'updated_at', f.updated_at
    )::jsonb AS out_data
    FROM recurring_rule_files f
    JOIN users u ON f.uploader_user_id = u.user_id
    WHERE f.file_id = p_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0618' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0611]Failed to restore recurring rule file: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0611';
END;
$$ LANGUAGE plpgsql;


-- 9. get_recurring_rule_file_download
-- 정기 일정 전용 파일 다운로드 정보 및 권한 검증
CREATE OR REPLACE FUNCTION get_recurring_rule_file_download(
    p_requester_email users.email%TYPE,
    p_file_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_creator_user_id users.user_id%TYPE;
BEGIN
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT r.owner_node_id, r.creator_user_id
    INTO v_owner_node_id, v_creator_user_id
    FROM recurring_rule_files f
    JOIN recurring_rules r ON f.rule_id = r.rule_id
    WHERE f.file_id = p_file_id AND f.is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist or already deleted: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 다운로드 권한 확인: FILE_VIEW 권한
    IF v_creator_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to download file. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE_FILE_DOWNLOAD',
        'file_id', f.file_id,
        'rule_id', f.rule_id,
        'original_file_name', f.original_file_name,
        'stored_file_name', f.stored_file_name,
        'file_path', f.file_path,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'updated_at', f.updated_at
    )::jsonb AS out_data
    FROM recurring_rule_files f
    WHERE f.file_id = p_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0613]Failed to get recurring rule file download: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0613';
END;
$$ LANGUAGE plpgsql;
