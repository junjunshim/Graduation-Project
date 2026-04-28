-- 컨트롤러에서 사용될 context 관련 함수 생성

-- ContextController::getInitialContext
CREATE OR REPLACE FUNCTION get_initial_context(
    p_user_email users.email%TYPE
) 
RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
BEGIN
    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 유저가 접근 가능한 노드의 모든 데이터 반환 (노드, 작업 항목, 역할, 권한)
    RETURN QUERY
    WITH RECURSIVE accessible_node_ids AS (
        SELECT node_id 
        FROM role_assignments 
        WHERE user_id = v_user_id
        
        UNION

        SELECT n.node_id 
        FROM organization_nodes n
        JOIN accessible_node_ids a ON n.parent_node_id = a.node_id
    )

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
    WHERE n.node_id IN (SELECT node_id FROM accessible_node_ids)

    UNION ALL

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
    WHERE w.owner_node_id IN (SELECT node_id FROM accessible_node_ids)

    UNION ALL

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
    WHERE ra.node_id IN (SELECT node_id FROM accessible_node_ids)

    UNION ALL

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
    WHERE auth.node_id IN (SELECT node_id FROM accessible_node_ids);

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0002]Error fetching initial context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0002';
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
BEGIN
    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_user_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_user_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 유저가 접근 가능한 노드의 모든 데이터 반환 (노드, 작업 항목, 역할, 권한)
    RETURN QUERY
    WITH RECURSIVE accessible_node_ids AS (
        SELECT node_id 
        FROM role_assignments 
        WHERE user_id = v_user_id
        
        UNION

        SELECT n.node_id 
        FROM organization_nodes n
        JOIN accessible_node_ids a ON n.parent_node_id = a.node_id
    )

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
    WHERE n.node_id IN (SELECT node_id FROM accessible_node_ids)
        AND n.updated_at > p_last_synced_at

    UNION ALL

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
    WHERE w.owner_node_id IN (SELECT node_id FROM accessible_node_ids)
        AND w.updated_at > p_last_synced_at

    UNION ALL

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
    WHERE ra.node_id IN (SELECT node_id FROM accessible_node_ids)
        AND ra.updated_at > p_last_synced_at
        
    UNION ALL

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
    WHERE auth.node_id IN (SELECT node_id FROM accessible_node_ids)
        AND auth.updated_at > p_last_synced_at;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0003]Error fetching sync context for user: % (REASON: %)', p_user_email, SQLERRM
        USING ERRCODE = 'P0003';
END;
$$ LANGUAGE plpgsql;