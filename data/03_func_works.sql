-- 컨트롤러에서 사용될 work_items 관련 함수 생성

-- WorkItemController::createWorkItem
CREATE OR REPLACE FUNCTION create_work_item(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_owner_node_id organization_nodes.node_id%TYPE,
    p_owner_user_email users.email%TYPE,
    p_title work_items.title%TYPE,
    p_parent_work_item_id work_items.parent_work_item_id%TYPE DEFAULT NULL,
    p_description work_items.description%TYPE DEFAULT NULL,
    p_status work_items.status%TYPE DEFAULT 'todo',
    p_priority work_items.priority%TYPE DEFAULT 3,
    p_weight work_items.weight%TYPE DEFAULT 1,
    p_progress work_items.progress%TYPE DEFAULT 0,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS SETOF action_result AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_requester_role role_assignments.role%TYPE;
    v_owner_user_role role_assignments.role%TYPE;
    v_requester_parent_role role_assignments.role%TYPE;
BEGIN
    -- 1. 요청자와 대상자의 user_id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;

    IF v_requester_id IS NULL OR v_owner_user_id IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 
            '사용자를 찾을 수 없습니다.'::TEXT, 
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

    -- 2. 요청자의 work_itme이 생성될 노드의 권한 확인
    SELECT role INTO v_requester_role 
    FROM role_assignments 
    WHERE user_id = v_requester_id AND node_id = p_owner_node_id;

    IF v_requester_role IS NULL OR v_requester_role NOT IN ('ADMIN', 'MANAGER', 'MEMBER') THEN
        RETURN QUERY SELECT 
            FALSE, 
            '요청자의 권한이 부족합니다. (ADMIN, MANAGER, MEMBER 권한 필요)'::TEXT, 
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

    -- 3. 대상자의 노드에 대한 권한 확인
    SELECT role INTO v_owner_user_role 
    FROM role_assignments 
    WHERE user_id = v_owner_user_id AND node_id = p_owner_node_id;
    
    IF v_owner_user_role IS NULL OR v_owner_user_role NOT IN ('ADMIN', 'MANAGER', 'MEMBER') THEN
        RETURN QUERY SELECT 
            FALSE, 
            '대상자가 해당 노드의 멤버가 아닙니다. (ADMIN, MANAGER, MEMBER 권한 필요)'::TEXT, 
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

    -- 4. 부모 work_item이 있을 경우 권한 확인
    IF p_parent_work_item_id IS NOT NULL AND p_parent_work_item_id <> '' THEN
        SELECT role INTO v_requester_parent_role 
        FROM role_assignments 
        WHERE node_id = (SELECT owner_node_id FROM work_items WHERE work_item_id = p_parent_work_item_id) 
          AND user_id = v_requester_id;
          
        IF v_requester_parent_role IS NULL THEN
            RETURN QUERY SELECT 
                FALSE, 
                '부모 업무에 대한 권한이 없습니다.'::TEXT, 
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
    END IF;

    -- 5. work_item 생성
    INSERT INTO work_items (
        work_item_id, 
        owner_node_id, 
        owner_user_id, 
        title, 
        parent_work_item_id, 
        description, 
        status, 
        priority, 
        weight, 
        progress, 
        start_date, 
        due_date
    ) VALUES (
        p_work_item_id,
        p_owner_node_id,
        v_owner_user_id,
        p_title,
        NULLIF(p_parent_work_item_id, ''),
        NULLIF(p_description, ''),
        COALESCE(NULLIF(p_status, ''), 'todo'),
        COALESCE(p_priority, 3),
        COALESCE(p_weight, 1),
        COALESCE(p_progress, 0),
        NULLIF(p_start_date, '')::DATE,
        NULLIF(p_due_date, '')::DATE
    );

    -- 6. 생성된 work_item 반환
    RETURN QUERY
    SELECT
        TRUE,
        'Work Item이 생성되었습니다.'::TEXT,
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
    WHERE w.work_item_id = p_work_item_id;
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::updateWorkItem
CREATE OR REPLACE FUNCTION update_work_item(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_title work_items.title%TYPE DEFAULT NULL,
    p_description work_items.description%TYPE DEFAULT NULL,
    p_status work_items.status%TYPE DEFAULT NULL,
    p_priority work_items.priority%TYPE DEFAULT -1,
    p_weight work_items.weight%TYPE DEFAULT -1,
    p_progress work_items.progress%TYPE DEFAULT -1,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS SETOF action_result AS $$
DECLARE
    v_requester_id  users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
BEGIN
    -- 1. 요청자의 user_id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RETURN QUERY SELECT 
            FALSE, 
            '사용자를 찾을 수 없습니다.'::TEXT, 
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

    -- 2. work_item 존재 여부 확인
    IF NOT EXISTS (SELECT 1 FROM work_items WHERE work_item_id = p_work_item_id) THEN
        RETURN QUERY SELECT 
            FALSE, 
            '업무를 찾을 수 없습니다.'::TEXT, 
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

    -- 3. 요청자의 권한 확인 (업무의 owner_user_id와 일치하거나, 업무가 속한 노드에 대한 ADMIN/ MANAGER 권한 필요)
    IF NOT EXISTS (
        SELECT 1 
        FROM work_items w
        JOIN role_assignments ra ON ra.node_id = w.owner_node_id
        WHERE w.work_item_id = p_work_item_id                              
          AND (w.owner_user_id = v_requester_id OR ra.user_id = v_requester_id AND ra.role IN ('ADMIN', 'MANAGER'))
    ) THEN
        RETURN QUERY SELECT 
            FALSE, 
            '업무를 수정할 권한이 없습니다.'::TEXT, 
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

    -- 4. work_item 업데이트
    UPDATE work_items
    SET
        title = COALESCE(NULLIF(p_title, ''), title),
        description = COALESCE(NULLIF(p_description, ''), description),
        status = COALESCE(NULLIF(p_status, ''), status),
        priority = CASE WHEN p_priority >= 1 AND p_priority <= 5 THEN p_priority ELSE priority END,
        weight = CASE WHEN p_weight >= 0 THEN p_weight ELSE weight END,
        progress = CASE WHEN p_progress >= 0 AND p_progress <= 100 THEN p_progress ELSE progress END,
        start_date = COALESCE(NULLIF(p_start_date, '')::DATE, start_date),
        due_date = COALESCE(NULLIF(p_due_date, '')::DATE, due_date)
    WHERE work_item_id = p_work_item_id;

    -- 5. 업데이트된 work_item 반환
    RETURN QUERY
    SELECT
        TRUE,
        'Work Item이 업데이트되었습니다.'::TEXT,
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
    WHERE w.work_item_id = p_work_item_id;
END;
$$ LANGUAGE plpgsql;