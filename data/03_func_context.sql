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
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role_id = auth.authority_id
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
        'display_id', w.display_id,
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
        'user_id', ra.user_id,
        'email', u.email,
        'user_name', u.name,
        'role', (SELECT role FROM role_authorities WHERE authority_id = ra.role_id),
        'role_id', ra.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = ra.role_id),
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW
        OR (ra.user_id = v_user_id) -- 본인 역할은 권한에 관계없이 항상 반환

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
        'role_id', auth.authority_id,
        'is_top_role', auth.is_top_role,
        'node_id', auth.node_id,
        'role', auth.role,
        'authority', auth.authority::TEXT,
        'updated_at', auth.updated_at
    )
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE ((fn.effective_authority & v_node_members_view) = v_node_members_view OR EXISTS (SELECT 1 FROM role_assignments own WHERE own.role_id = auth.authority_id AND own.user_id = v_user_id)) -- Bit 1: NODE_MEMBERS_VIEW

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


-- 워크스페이스 진입점 화면용 경량 스코프 조회 함수
-- 접근 가능한 노드 목록(NODE) + 각 노드의 역할(ROLE) + 권한(AUTHORITY) + 직속 멤버 정보를 가볍게 반환 (업무/파일/활동 제외)
CREATE OR REPLACE FUNCTION get_workspace_directory_scope(
    p_user_email users.email%TYPE
)
RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node_info_view BIT(24);
    v_node_members_view BIT(24);
    v_node_sub_view BIT(24);
    v_node_parent_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 노드 식별 및 권한 관련 필수 비트 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view, v_node_sub_view, v_node_parent_view, v_deny
    FROM authority_constants
    WHERE name IN ('NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW', 'DENY');

    -- 1. 유저 존재 여부 확인
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 유저가 접근 가능한 노드 및 권한 계산 (Path 기반 비재귀 스코프)
    RETURN QUERY
    WITH assigned_nodes AS (
        SELECT 
            ra.node_id,
            BIT_OR(auth.authority) as authority
        FROM role_assignments ra
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role_id = auth.authority_id
        WHERE ra.user_id = v_user_id
        GROUP BY ra.node_id
    ),
    visible_node_ids AS (
        -- 직접 할당된 노드
        SELECT node_id FROM assigned_nodes
        WHERE (authority & v_node_info_view) = v_node_info_view
        UNION
        -- 하위 노드 탐색 (모든 후손 노드)
        SELECT n.node_id
        FROM organization_nodes n
        JOIN assigned_nodes an ON n.path @> ARRAY[an.node_id]
        WHERE (an.authority & v_node_sub_view) = v_node_sub_view
        UNION
        -- 상위 조상 노드 식별
        SELECT unnest(an_node.path)
        FROM organization_nodes an_node
        JOIN assigned_nodes an ON an.node_id = an_node.node_id
        WHERE (an.authority & v_node_parent_view) = v_node_parent_view
    ),
    final_visible_nodes AS (
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

    -- A. 접근 가능한 NODE 메타데이터 반환 (is_deleted 포함)
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'is_deleted', n.is_deleted,
        'created_at', to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'updated_at', to_char(n.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- B. 각 노드의 ROLE 데이터 반환 (본인 역할 또는 멤버 열람 권한 있는 역할)
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'user_id', ra.user_id,
        'email', u.email,
        'user_name', u.name,
        'role', (SELECT role FROM role_authorities WHERE authority_id = ra.role_id),
        'role_id', ra.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = ra.role_id),
        'updated_at', to_char(ra.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE ((fn.effective_authority & v_node_members_view) = v_node_members_view OR ra.user_id = v_user_id)
      AND u.is_deleted = FALSE

    UNION ALL

    -- C. 각 노드의 AUTHORITY 정의 데이터 반환
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', auth.authority_id,
        'role_id', auth.authority_id,
        'is_top_role', auth.is_top_role,
        'node_id', auth.node_id,
        'role', auth.role,
        'authority', auth.authority::TEXT,
        'updated_at', to_char(auth.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE ((fn.effective_authority & v_node_members_view) = v_node_members_view 
       OR EXISTS (SELECT 1 FROM role_assignments own WHERE own.role_id = auth.authority_id AND own.user_id = v_user_id));

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0202]Error fetching workspace directory scope for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0202';
END;
$$ LANGUAGE plpgsql;

-- ContextController::getDashboardContext
-- 대시보드 화면 전용 조회 함수
-- A. 조회자/기준일 : 대시보드는 "오늘"과 "이번 주" 기준 집계를 쓰므로 기준일을 함께 내려준다.
-- B. 내 업무       : 담당자가 조회자인 업무 중 최근 6개월 범위만 반환 (스코프와 무관하게 본인 업무는 항상 노출)
-- C. 스코프 일정   : 접근 가능한 노드에 속한 정기 일정 전체를 반환
CREATE OR REPLACE FUNCTION get_dashboard_context(
    p_user_email users.email%TYPE
)
RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node_info_view BIT(24);
    v_node_sub_view BIT(24);
    v_node_parent_view BIT(24);
    v_deny BIT(24);
    v_today DATE;
    v_week_start DATE;
    v_week_end DATE;
    v_range_start DATE;
    v_viewer_node_id INTEGER;
    v_viewer_role TEXT;
BEGIN
    -- 0. 기준일 계산 (DB 세션 시간대에 흔들리지 않도록 사용자 시간대를 명시)
    v_today := (now() AT TIME ZONE 'Asia/Seoul')::DATE;
    v_week_start := date_trunc('week', v_today::TIMESTAMP)::DATE;   -- 월요일 시작
    v_week_end := (v_week_start + INTERVAL '6 days')::DATE;
    v_range_start := (v_today - INTERVAL '6 months')::DATE;

    -- 1. 스코프 계산에 필요한 권한 비트 로드
    SELECT
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO
        v_node_info_view, v_node_sub_view, v_node_parent_view, v_deny
    FROM authority_constants
    WHERE name IN ('NODE_INFO_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW', 'DENY');

    -- 2. 조회자 확인
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email AND is_deleted = FALSE;
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 3. 헤더 표시용 소속/역할 (최상위 역할 우선, 없으면 먼저 배정된 역할)
    SELECT ra.node_id, rauth.role
    INTO v_viewer_node_id, v_viewer_role
    FROM role_assignments ra
    JOIN role_authorities rauth ON rauth.authority_id = ra.role_id
    WHERE ra.user_id = v_user_id
    ORDER BY rauth.is_top_role DESC, ra.assignment_id ASC
    LIMIT 1;

    RETURN QUERY
    WITH assigned_nodes AS (
        SELECT
            ra.node_id,
            BIT_OR(auth.authority) as authority
        FROM role_assignments ra
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role_id = auth.authority_id
        WHERE ra.user_id = v_user_id
        GROUP BY ra.node_id
    ),
    visible_node_ids AS (
        -- 직접 할당된 노드
        SELECT node_id FROM assigned_nodes
        WHERE (authority & v_node_info_view) = v_node_info_view
        UNION
        -- 하위 노드 탐색 (모든 후손 노드)
        SELECT n.node_id
        FROM organization_nodes n
        JOIN assigned_nodes an ON n.path @> ARRAY[an.node_id]
        WHERE (an.authority & v_node_sub_view) = v_node_sub_view
        UNION
        -- 상위 조상 노드 식별
        SELECT unnest(an_node.path)
        FROM organization_nodes an_node
        JOIN assigned_nodes an ON an.node_id = an_node.node_id
        WHERE (an.authority & v_node_parent_view) = v_node_parent_view
    ),
    final_visible_nodes AS (
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

    -- A. 조회자 및 기준일 정보
    SELECT jsonb_build_object(
        'type', 'DASHBOARD_VIEWER',
        'user_id', u.user_id,
        'email', u.email,
        'name', u.name,
        'role', v_viewer_role,
        'node_id', v_viewer_node_id,
        'node_title', vn.name,
        'today', v_today,
        'week_start_date', v_week_start,
        'week_end_date', v_week_end,
        'range_start_date', v_range_start
    )
    FROM users u
    LEFT JOIN organization_nodes vn ON vn.node_id = v_viewer_node_id
    WHERE u.user_id = v_user_id

    UNION ALL

    -- B. 담당자가 조회자인 업무 (최근 6개월 : 마감일 → 시작일 → 수정일 순으로 기준일 판정)
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'display_id', w.display_id,
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
    LEFT JOIN (
        SELECT work_item_id, COUNT(*)::INT as cnt
        FROM work_item_comments
        GROUP BY work_item_id
    ) cc ON w.work_item_id = cc.work_item_id
    WHERE w.owner_user_id = v_user_id
      AND w.is_deleted = FALSE
      AND COALESCE(w.due_date, w.start_date, w.updated_at::DATE) >= v_range_start

    UNION ALL

    -- C. 스코프에 속한 정기 일정 전체
    SELECT jsonb_build_object(
        'type', 'RECURRING_RULE',
        'rule_id', r.rule_id,
        'owner_node_id', r.owner_node_id,
        'creator_user_id', r.creator_user_id,
        'assignee_user_id', r.assignee_user_id,
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
        'updated_at', r.updated_at
    )
    FROM recurring_rules r
    WHERE r.owner_node_id IN (SELECT node_id FROM filtered_nodes)
      AND r.is_deleted = FALSE;

    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0203]Error fetching dashboard context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0203';
END;
$$ LANGUAGE plpgsql;
