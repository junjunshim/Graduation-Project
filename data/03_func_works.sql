-- 컨트롤러에서 사용될 work_items 관련 함수 생성

-- WorkItemController::createWorkItem
CREATE OR REPLACE FUNCTION create_work_item(
    p_requester_email VARCHAR,
    p_work_item_id VARCHAR,
    p_owner_node_id INTEGER,
    p_owner_user_email VARCHAR,
    p_title VARCHAR,
    p_parent_work_item_id VARCHAR DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_status VARCHAR DEFAULT 'todo',
    p_priority INTEGER DEFAULT 3,
    p_weight INTEGER DEFAULT 1,
    p_progress INTEGER DEFAULT 0,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS SETOF action_result AS $$
DECLARE
    v_requester_id VARCHAR;
    v_owner_user_id VARCHAR;
    v_requester_role VARCHAR;
    v_owner_user_role VARCHAR;
    v_requester_parent_role VARCHAR;
BEGIN
    -- 1. 요청자와 대상자의 user_id 가져오기
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;

    IF v_requester_id IS NULL OR v_owner_user_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '사용자를 찾을 수 없습니다.'::TEXT, NULL::integrated_data;
        RETURN;
    END IF;

    -- 2. 요청자의 work_itme이 생성될 노드의 권한 확인
    SELECT role INTO v_requester_role 
    FROM role_assignments 
    WHERE user_id = v_requester_id AND node_id = p_owner_node_id;

    IF v_requester_role IS NULL OR v_requester_role NOT IN ('ADMIN', 'MANAGER', 'MEMBER') THEN
        RETURN QUERY SELECT FALSE, '요청자의 권한이 부족합니다. (ADMIN, MANAGER, MEMBER 권한 필요)'::TEXT, NULL::integrated_data;
        RETURN;
    END IF;

    -- 3. 대상자의 노드에 대한 권한 확인
    SELECT role INTO v_owner_user_role 
    FROM role_assignments 
    WHERE user_id = v_owner_user_id AND node_id = p_owner_node_id;
    
    IF v_owner_user_role IS NULL OR v_owner_user_role NOT IN ('ADMIN', 'MANAGER', 'MEMBER') THEN
        RETURN QUERY SELECT FALSE, '대상자가 해당 노드의 멤버가 아닙니다. (ADMIN, MANAGER, MEMBER 권한 필요)'::TEXT, NULL::integrated_data;
        RETURN;
    END IF;

    -- 4. 부모 work_item이 있을 경우 권한 확인
    IF p_parent_work_item_id IS NOT NULL AND p_parent_work_item_id <> '' THEN
        SELECT role INTO v_requester_parent_role 
        FROM role_assignments 
        WHERE node_id = (SELECT owner_node_id FROM work_items WHERE work_item_id = p_parent_work_item_id) 
          AND user_id = v_requester_id;
          
        IF v_requester_parent_role IS NULL THEN
            RETURN QUERY SELECT FALSE, '부모 업무에 대한 권한이 없습니다.'::TEXT, NULL::integrated_data;
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
        ROW(
            'WORK_ITEM'::TEXT,
            w.work_item_id::TEXT,
            NULL::TEXT,
            w.owner_node_id::TEXT,
            w.title::TEXT,
            w.status::TEXT,
            w.priority::INTEGER,
            w.parent_work_item_id::TEXT,
            w.updated_at::TEXT
        )::integrated_data AS out_data
    FROM work_items w
    WHERE w.work_item_id = p_work_item_id;
END;
$$ LANGUAGE plpgsql;