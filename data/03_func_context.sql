-- 컨트롤러에서 사용될 context 관련 함수 생성

-- ContextController::getInitialContext
CREATE OR REPLACE FUNCTION get_initial_context(
    p_user_email VARCHAR
) 
RETURNS SETOF integrated_data AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE accessible_node_ids AS (
        SELECT node_id 
        FROM role_assignments 
        WHERE user_id = (SELECT user_id FROM users WHERE email = p_user_email)
        
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
    WHERE ra.node_id IN (SELECT node_id FROM accessible_node_ids);
END;
$$ LANGUAGE plpgsql;


-- ContextController::syncContext
CREATE OR REPLACE FUNCTION sync_context(
    p_user_email VARCHAR,
    p_last_synced_at TIMESTAMP
) 
RETURNS SETOF integrated_data AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE accessible_node_ids AS (
        SELECT node_id FROM role_assignments WHERE user_id = (SELECT user_id FROM users WHERE email = p_user_email)
        
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
      AND w.updated_at > p_last_synced_at;
END;
$$ LANGUAGE plpgsql;