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
    v_wi_private_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 권한 비트 한 번에 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PRIVATE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view, v_node_sub_view, v_node_parent_view,
        v_wi_public_view, v_wi_private_view, v_wi_hidden_view, v_deny
    FROM authority_constants
    WHERE name IN (
        'NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW',
        'WI_PUBLIC_VIEW', 'WI_PRIVATE_VIEW', 'WI_HIDDEN_VIEW', 'DENY'
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
    SELECT 
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.node_type::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM filtered_nodes)

    UNION ALL

    -- WORK_ITEM 데이터 반환
    SELECT 
        'WORK_ITEM'::TEXT,
        w.work_item_id::TEXT,
        NULL::TEXT,
        w.owner_node_id::TEXT,
        w.title::TEXT,
        w.status::TEXT,
        w.priority::INTEGER,
        w.parent_work_item_id::TEXT,
        w.updated_at::TEXT
    FROM work_items w
    JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
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
    SELECT 
        'ROLE'::TEXT,
        ra.assignment_id::TEXT,
        NULL::TEXT,
        ra.node_id::TEXT,
        u.email::TEXT,
        ra.role::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        ra.updated_at::TEXT
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- AUTHORITY 데이터 반환
    SELECT 
        'AUTHORITY'::TEXT,
        auth.authority_id::TEXT,
        NULL::TEXT,
        auth.node_id::TEXT,
        auth.role::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        auth.authority::TEXT,
        auth.updated_at::TEXT
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE (fn.effective_authority & v_node_members_view) = v_node_members_view; -- Bit 1: NODE_MEMBERS_VIEW

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
    v_wi_private_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 권한 비트 한 번에 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_SUB_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_PARENT_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PRIVATE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view, v_node_sub_view, v_node_parent_view,
        v_wi_public_view, v_wi_private_view, v_wi_hidden_view, v_deny
    FROM authority_constants
    WHERE name IN (
        'NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW', 'NODE_SUB_VIEW', 'NODE_PARENT_VIEW',
        'WI_PUBLIC_VIEW', 'WI_PRIVATE_VIEW', 'WI_HIDDEN_VIEW', 'DENY'
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

    -- NODE 데이터 반환
    SELECT 
        'NODE'::TEXT,
        n.node_id::TEXT,
        n.node_type::TEXT,
        n.parent_node_id::TEXT,
        n.name::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        n.path::TEXT,
        n.updated_at::TEXT
    FROM organization_nodes n
    WHERE n.node_id IN (SELECT node_id FROM filtered_nodes)
        AND n.updated_at > p_last_synced_at

    UNION ALL

    -- WORK_ITEM 데이터 반환
    SELECT 
        'WORK_ITEM'::TEXT,
        w.work_item_id::TEXT,
        NULL::TEXT,
        w.owner_node_id::TEXT,
        w.title::TEXT,
        w.status::TEXT,
        w.priority::INTEGER,
        w.parent_work_item_id::TEXT,
        w.updated_at::TEXT
    FROM work_items w
    JOIN filtered_nodes fn ON w.owner_node_id = fn.node_id
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

    -- ROLE 데이터 반환
    SELECT 
        'ROLE'::TEXT,
        ra.assignment_id::TEXT,
        NULL::TEXT,
        ra.node_id::TEXT,
        u.email::TEXT,
        ra.role::TEXT,
        NULL::INTEGER,
        NULL::TEXT,
        ra.updated_at::TEXT
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    JOIN filtered_nodes fn ON ra.node_id = fn.node_id
    WHERE ra.updated_at > p_last_synced_at
        AND (fn.effective_authority & v_node_members_view) = v_node_members_view -- Bit 1: NODE_MEMBERS_VIEW

    UNION ALL

    -- AUTHORITY 데이터 반환
    SELECT 
        'AUTHORITY'::TEXT,
        auth.authority_id::TEXT,
        NULL::TEXT,
        auth.node_id::TEXT,
        auth.role::TEXT,
        NULL::TEXT,
        NULL::INTEGER,
        auth.authority::TEXT,
        auth.updated_at::TEXT
    FROM role_authorities auth
    JOIN filtered_nodes fn ON auth.node_id = fn.node_id
    WHERE auth.updated_at > p_last_synced_at
        AND (fn.effective_authority & v_node_members_view) = v_node_members_view; -- Bit 1: NODE_MEMBERS_VIEW

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0202]Error fetching sync context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0202';
END;
$$ LANGUAGE plpgsql;
