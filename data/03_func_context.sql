-- 컨트롤러에서 사용될 context 관련 함수 생성

-- ContextController::getInitialContext
CREATE OR REPLACE FUNCTION get_initial_context(
    p_user_email users.email%TYPE
) 
RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node_info_view BIT(24);
    v_node_members_view BIT(24);
    v_node_sub_view BIT(24);
    v_node_parent_view BIT(24);
    v_wi_public_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_file_view BIT(24);
    v_history_personal_view BIT(24);
    v_history_all_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 권한 비트 한 번에 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'FILE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_PERSONAL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_ALL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view, v_node_sub_view, v_node_parent_view,
        v_wi_public_view, v_wi_hidden_view, v_file_view,
        v_history_personal_view, v_history_all_view, v_deny
    FROM authority_constants
    WHERE name IN (
        'NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW',
        'WI_PUBLIC_VIEW', 'WI_HIDDEN_VIEW', 'FILE_VIEW',
        'HISTORY_PERSONAL_VIEW', 'HISTORY_ALL_VIEW', 'DENY'
    );

    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 유저가 접근 가능한 노드 및 권한 계산 (Non-recursive Path-based approach)
    RETURN QUERY
    WITH assigned_nodes AS (
        -- 사용자가 직접 역할이 있는 노드와 그 권한
        SELECT 
            ra.node_id,
            BIT_OR(auth.authority) as authority
        FROM role_assignments ra
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
        WHERE ra.user_id = v_user_id
        GROUP BY ra.node_id
    ),
    visible_node_ids AS (
        -- 1. 직접 할당된 노드 (Bit 0: NODE_INFO_VIEW)
        SELECT node_id FROM assigned_nodes
        WHERE (authority & v_node_info_view) = v_node_info_view

        UNION

        -- 2. 하위 노드 탐색 (Bit 2: NODE_SUB_VIEW) - 모든 후손 노드
        SELECT n.node_id
        FROM organization_nodes n
        JOIN assigned_nodes an ON n.path @> ARRAY[an.node_id]
        WHERE (an.authority & v_node_sub_view) = v_node_sub_view

        UNION

        -- 3. 상위 노드 탐색 (Bit 3: NODE_PARENT_VIEW) - 모든 조상 노드
        SELECT unnest(an_node.path)
        FROM organization_nodes an_node
        JOIN assigned_nodes an ON an.node_id = an_node.node_id
        WHERE (an.authority & v_node_parent_view) = v_node_parent_view
    ),
    final_visible_nodes AS (
        -- 각 노드에 대해 해당 유저가 가진 권한을 다시 계산 (상속 포함 - Override 정책)
        SELECT 
            vn.node_id,
            get_effective_authority(v_user_id, vn.node_id) as effective_authority
        FROM (SELECT DISTINCT node_id FROM visible_node_ids) vn
    )
    -- DENY 비트 체크 (Bit 23)
    , filtered_nodes AS (
        SELECT * FROM final_visible_nodes
        WHERE (effective_authority & v_deny) != v_deny
           OR effective_authority IS NULL
    )

    -- NODE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'is_deleted', n.is_deleted,
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- WORK_ITEM 데이터 반환
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'parent_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        'title', w.title,
        'description', w.description,
        'category', w.category,
        'status', w.status,
        'priority', w.priority,
        'hidden', w.hidden,
        'weight', w.weight,
        'progress', w.progress,
        'comment_count', COALESCE(cc.cnt, 0),
        'is_deleted', w.is_deleted,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'updated_at', w.updated_at
    )
    FROM work_items w
    JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
    LEFT JOIN (
        SELECT work_item_id, COUNT(*)::INT as cnt
        FROM work_item_comments
        GROUP BY work_item_id
    ) cc ON w.work_item_id = cc.work_item_id
    WHERE 
        -- 공개 WI (Bit 4: WI_PUBLIC_VIEW)
        ((fn.effective_authority & v_wi_public_view) = v_wi_public_view AND w.hidden = FALSE)
        OR
        -- 숨김 WI (Bit 6: WI_HIDDEN_VIEW)
        ((fn.effective_authority & v_wi_hidden_view) = v_wi_hidden_view)
        OR
        -- 내 WI
        (w.owner_user_id = v_user_id)

    UNION ALL

    -- ROLE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'email', u.email,
        'role', ra.role,
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- USER 데이터 반환 (접근 권한 있는 노드에 소속된 모든 사용자 정보)
    SELECT DISTINCT ON (u.user_id) jsonb_build_object(
        'type', 'USER',
        'id', u.user_id,
        'email', u.email,
        'name', u.name,
        'created_at', u.created_at,
        'updated_at', u.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view
      AND u.is_deleted = FALSE

    UNION ALL

    -- AUTHORITY 데이터 반환
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', auth.authority_id,
        'node_id', auth.node_id,
        'role', auth.role,
        'authority', auth.authority::TEXT,
        'updated_at', auth.updated_at
    )
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- MENTION 데이터 반환 (로그인 유저가 읽지 않은 알림)
    SELECT jsonb_build_object(
        'type', 'MENTION',
        'id', m.mention_id,
        'comment_id', m.comment_id,
        'work_item_id', c.work_item_id,
        'message', u_author.name || '님이 댓글에서 회원님을 멘션했습니다.',
        'is_read', m.is_read,
        'created_at', m.created_at,
        'updated_at', m.updated_at
    )
    FROM comment_mentions m
    JOIN work_item_comments c ON m.comment_id = c.comment_id
    JOIN users u_author ON c.author_user_id = u_author.user_id
    WHERE m.mentioned_user_id = v_user_id AND m.is_read = FALSE

    UNION ALL

    -- ACTIVITY 데이터 반환 (접근 권한 있는 노드의 최신 활동 5개)
    SELECT jsonb_build_object(
        'type', 'ACTIVITY',
        'id', latest_act.log_id,
        'node_id', latest_act.node_id,
        'actor_user_id', latest_act.actor_user_id,
        'actor_name', latest_act.actor_name,
        'entity_type', latest_act.entity_type,
        'entity_id', latest_act.entity_id,
        'target_name', latest_act.target_name,
        'action_type', latest_act.action_type,
        'field_name', latest_act.field_name,
        'old_value', latest_act.old_value,
        'new_value', latest_act.new_value,
        'created_at', latest_act.created_at
    )
    FROM (
        SELECT al.*
        FROM activity_logs al
        JOIN filtered_nodes fn ON al.node_id = fn.node_id
        WHERE 
            -- 전체 히스토리 권한이 있거나, 본인의 활동인 경우
            ((fn.effective_authority & v_history_all_view) = v_history_all_view)
            OR
            (((fn.effective_authority & v_history_personal_view) = v_history_personal_view) AND al.actor_user_id = v_user_id)
        ORDER BY al.created_at DESC
        LIMIT 5
    ) latest_act

    UNION ALL

    -- FILE 데이터 반환 (접근 권한 있는 업무의 최신 첨부파일 5개)
    SELECT jsonb_build_object(
        'type', 'FILE',
        'id', latest_f.file_id,
        'work_item_id', latest_f.work_item_id,
        'uploader_user_id', latest_f.uploader_user_id,
        'uploader_name', latest_f.uploader_name,
        'uploader_email', latest_f.uploader_email,
        'original_file_name', latest_f.original_file_name,
        'file_size', latest_f.file_size,
        'mime_type', latest_f.mime_type,
        'is_deleted', latest_f.is_deleted,
        'created_at', latest_f.created_at,
        'updated_at', latest_f.updated_at
    )
    FROM (
        SELECT 
            f.file_id,
            f.work_item_id,
            f.uploader_user_id,
            u.name AS uploader_name,
            u.email AS uploader_email,
            f.original_file_name,
            f.file_size,
            f.mime_type,
            f.is_deleted,
            f.created_at,
            f.updated_at
        FROM work_item_files f
        JOIN work_items w ON f.work_item_id = w.work_item_id
        JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
        JOIN users u ON f.uploader_user_id = u.user_id
        WHERE (
                (w.owner_user_id = v_user_id)
                OR
                ((fn.effective_authority & v_file_view) = v_file_view AND (
                    (w.hidden = FALSE AND (fn.effective_authority & v_wi_public_view) = v_wi_public_view)
                    OR
                    (w.hidden = TRUE AND (fn.effective_authority & v_wi_hidden_view) = v_wi_hidden_view)
                ))
            )
        ORDER BY f.created_at DESC
        LIMIT 5
    ) latest_f;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0201]Error fetching initial context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0201';
END;
$$ LANGUAGE plpgsql;


-- ContextController::syncContext
CREATE OR REPLACE FUNCTION sync_context(
    p_user_email users.email%TYPE,
    p_last_synced_at TIMESTAMP
) 
RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node_info_view BIT(24);
    v_node_members_view BIT(24);
    v_node_sub_view BIT(24);
    v_node_parent_view BIT(24);
    v_wi_public_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_file_view BIT(24);
    v_history_personal_view BIT(24);
    v_history_all_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 권한 비트 한 번에 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'FILE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_PERSONAL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_ALL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view, v_node_sub_view, v_node_parent_view,
        v_wi_public_view, v_wi_hidden_view, v_file_view,
        v_history_personal_view, v_history_all_view, v_deny
    FROM authority_constants
    WHERE name IN (
        'NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW',
        'WI_PUBLIC_VIEW', 'WI_HIDDEN_VIEW', 'FILE_VIEW',
        'HISTORY_PERSONAL_VIEW', 'HISTORY_ALL_VIEW', 'DENY'
    );

    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 유저가 접근 가능한 노드 및 권한 계산 (Non-recursive Path-based approach)
    RETURN QUERY
    WITH assigned_nodes AS (
        SELECT 
            ra.node_id,
            BIT_OR(auth.authority) as authority
        FROM role_assignments ra
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
        WHERE ra.user_id = v_user_id
        GROUP BY ra.node_id
    ),
    visible_node_ids AS (
        -- 1. 직접 할당된 노드 (Bit 0: NODE_INFO_VIEW)
        SELECT node_id FROM assigned_nodes
        WHERE (authority & v_node_info_view) = v_node_info_view

        UNION

        -- 2. 하위 노드 탐색 (Bit 2: NODE_SUB_VIEW) - 모든 후손 노드
        SELECT n.node_id
        FROM organization_nodes n
        JOIN assigned_nodes an ON n.path @> ARRAY[an.node_id]
        WHERE (an.authority & v_node_sub_view) = v_node_sub_view
        
        UNION
        
        -- 3. 상위 노드 탐색 (Bit 3: NODE_PARENT_VIEW) - 모든 조상 노드
        SELECT unnest(an_node.path)
        FROM organization_nodes an_node
        JOIN assigned_nodes an ON an.node_id = an_node.node_id
        WHERE (an.authority & v_node_parent_view) = v_node_parent_view
    ),
    final_visible_nodes AS (
        -- 각 노드에 대해 해당 유저가 가진 권한을 다시 계산 (상속 포함 - Override 정책)
        SELECT 
            vn.node_id,
            get_effective_authority(v_user_id, vn.node_id) as effective_authority
        FROM (SELECT DISTINCT node_id FROM visible_node_ids) vn
    ),
    filtered_nodes AS (
        SELECT * FROM final_visible_nodes
        WHERE (effective_authority & v_deny) != v_deny
           OR effective_authority IS NULL
    )

    -- 1. 신규/수정 NODE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'is_deleted', n.is_deleted,
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM filtered_nodes)
        AND n.updated_at > p_last_synced_at

    UNION ALL

    -- 2. 삭제된 NODE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', h.node_id,
        'status', 'deleted',
        'is_deleted', true,
        'updated_at', h.history_created_at
    )
    FROM organization_node_histories h
    WHERE h.change_status = 'deleted'
        AND h.history_created_at > p_last_synced_at
        AND (
            h.node_id IN (SELECT node_id FROM filtered_nodes)
            OR h.parent_node_id IN (SELECT node_id FROM filtered_nodes)
        )

    UNION ALL

    -- 3. 신규/수정 WORK_ITEM 데이터 반환
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'parent_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        'title', w.title,
        'description', w.description,
        'category', w.category,
        'status', w.status,
        'priority', w.priority,
        'hidden', w.hidden,
        'weight', w.weight,
        'progress', w.progress,
        'comment_count', COALESCE(cc.cnt, 0),
        'is_deleted', w.is_deleted,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'updated_at', w.updated_at
    )
    FROM work_items w
    JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
    LEFT JOIN (
        SELECT work_item_id, COUNT(*)::INT as cnt
        FROM work_item_comments
        GROUP BY work_item_id
    ) cc ON w.work_item_id = cc.work_item_id
    WHERE w.updated_at > p_last_synced_at
        AND (
            -- 공개 WI (Bit 4: WI_PUBLIC_VIEW)
            ((fn.effective_authority & v_wi_public_view) = v_wi_public_view AND w.hidden = FALSE)
            OR
            -- 숨김 WI (Bit 6: WI_HIDDEN_VIEW)
            ((fn.effective_authority & v_wi_hidden_view) = v_wi_hidden_view)
            OR
            -- 내 WI
            (w.owner_user_id = v_user_id)
        )

    UNION ALL

    -- 4. 삭제된 WORK_ITEM 데이터 반환
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', h.work_item_id,
        'status', 'deleted',
        'is_deleted', true,
        'updated_at', h.history_created_at
    )
    FROM work_item_histories h
    WHERE h.change_status = 'deleted'
        AND h.history_created_at > p_last_synced_at
        AND h.owner_node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- 5. 신규/수정 ROLE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'email', u.email,
        'role', ra.role,
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE ra.updated_at > p_last_synced_at
        AND (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- 5.5 신규/수정 USER 데이터 반환
    SELECT DISTINCT ON (u.user_id) jsonb_build_object(
        'type', 'USER',
        'id', u.user_id,
        'email', u.email,
        'name', u.name,
        'created_at', u.created_at,
        'updated_at', u.updated_at
    )
    FROM users u
    WHERE u.updated_at > p_last_synced_at
      AND u.is_deleted = FALSE
      AND u.user_id IN (
          SELECT ra.user_id 
          FROM role_assignments ra 
          JOIN filtered_nodes fn ON ra.node_id = fn.node_id 
          WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view
      )

    UNION ALL

    -- 6. 삭제된 ROLE 데이터 반환
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', h.assignment_id,
        'status', 'deleted',
        'updated_at', h.history_created_at
    )
    FROM role_assignment_histories h
    WHERE h.change_status = 'deleted'
        AND h.history_created_at > p_last_synced_at
        AND h.node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- 7. 신규/수정 AUTHORITY 데이터 반환
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', auth.authority_id,
        'node_id', auth.node_id,
        'role', auth.role,
        'authority', auth.authority::TEXT,
        'updated_at', auth.updated_at
    )
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE auth.updated_at > p_last_synced_at
        AND (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- 8. 삭제된 AUTHORITY 데이터 반환
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', h.authority_id,
        'status', 'deleted',
        'updated_at', h.history_created_at
    )
    FROM role_authority_histories h
    WHERE h.change_status = 'deleted'
        AND h.history_created_at > p_last_synced_at
        AND h.node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- 9. 신규/수정/읽음처리 MENTION 데이터 반환
    SELECT jsonb_build_object(
        'type', 'MENTION',
        'id', m.mention_id,
        'comment_id', m.comment_id,
        'work_item_id', c.work_item_id,
        'message', u_author.name || '님이 댓글에서 회원님을 멘션했습니다.',
        'is_read', m.is_read,
        'created_at', m.created_at,
        'updated_at', m.updated_at
    )
    FROM comment_mentions m
    JOIN work_item_comments c ON m.comment_id = c.comment_id
    JOIN users u_author ON c.author_user_id = u_author.user_id
    WHERE m.mentioned_user_id = v_user_id
        AND m.updated_at > p_last_synced_at

    UNION ALL

    -- 10. ACTIVITY 데이터 반환 (동기화 시점 이후의 신규 활동 최신 5개)
    SELECT jsonb_build_object(
        'type', 'ACTIVITY',
        'id', latest_act.log_id,
        'node_id', latest_act.node_id,
        'actor_user_id', latest_act.actor_user_id,
        'actor_name', latest_act.actor_name,
        'entity_type', latest_act.entity_type,
        'entity_id', latest_act.entity_id,
        'target_name', latest_act.target_name,
        'action_type', latest_act.action_type,
        'field_name', latest_act.field_name,
        'old_value', latest_act.old_value,
        'new_value', latest_act.new_value,
        'created_at', latest_act.created_at
    )
    FROM (
        SELECT al.*
        FROM activity_logs al
        JOIN filtered_nodes fn ON al.node_id = fn.node_id
        WHERE al.created_at > p_last_synced_at
            AND (
                ((fn.effective_authority & v_history_all_view) = v_history_all_view)
                OR
                (((fn.effective_authority & v_history_personal_view) = v_history_personal_view) AND al.actor_user_id = v_user_id)
            )
        ORDER BY al.created_at DESC
        LIMIT 5
    ) latest_act

    UNION ALL

    -- 11. 신규/수정 FILE 데이터 반환 (동기화 시점 이후의 신규/수정 첨부파일 최신 5개)
    SELECT jsonb_build_object(
        'type', 'FILE',
        'id', latest_f.file_id,
        'work_item_id', latest_f.work_item_id,
        'uploader_user_id', latest_f.uploader_user_id,
        'uploader_name', latest_f.uploader_name,
        'uploader_email', latest_f.uploader_email,
        'original_file_name', latest_f.original_file_name,
        'file_size', latest_f.file_size,
        'mime_type', latest_f.mime_type,
        'is_deleted', latest_f.is_deleted,
        'created_at', latest_f.created_at,
        'updated_at', latest_f.updated_at
    )
    FROM (
        SELECT 
            f.file_id,
            f.work_item_id,
            f.uploader_user_id,
            u.name AS uploader_name,
            u.email AS uploader_email,
            f.original_file_name,
            f.file_size,
            f.mime_type,
            f.is_deleted,
            f.created_at,
            f.updated_at
        FROM work_item_files f
        JOIN work_items w ON f.work_item_id = w.work_item_id
        JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
        JOIN users u ON f.uploader_user_id = u.user_id
        WHERE f.updated_at > p_last_synced_at
            AND (
                (w.owner_user_id = v_user_id)
                OR
                ((fn.effective_authority & v_file_view) = v_file_view AND (
                    (w.hidden = FALSE AND (fn.effective_authority & v_wi_public_view) = v_wi_public_view)
                    OR
                    (w.hidden = TRUE AND (fn.effective_authority & v_wi_hidden_view) = v_wi_hidden_view)
                ))
            )
        ORDER BY f.created_at DESC
        LIMIT 5
    ) latest_f

    UNION ALL

    -- 12. 삭제된 FILE 데이터 반환 (동기화 시점 이후 삭제된 파일)
    SELECT jsonb_build_object(
        'type', 'FILE',
        'id', f.file_id,
        'status', 'deleted',
        'is_deleted', true,
        'updated_at', f.updated_at
    )
    FROM work_item_files f
    JOIN work_items w ON f.work_item_id = w.work_item_id
    JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
    WHERE f.is_deleted = TRUE
        AND f.updated_at > p_last_synced_at
        AND (
            (w.owner_user_id = v_user_id)
            OR
            ((fn.effective_authority & v_file_view) = v_file_view)
        );

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0202]Error fetching sync context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0202';
END;
$$ LANGUAGE plpgsql;
