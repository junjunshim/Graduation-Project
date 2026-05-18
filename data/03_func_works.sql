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
    p_hidden work_items.hidden%TYPE DEFAULT FALSE,
    p_status work_items.status%TYPE DEFAULT 'todo',
    p_priority work_items.priority%TYPE DEFAULT 3,
    p_weight work_items.weight%TYPE DEFAULT 1,
    p_progress work_items.progress%TYPE DEFAULT 0,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_parent_work_item_owner_node_id organization_nodes.node_id%TYPE;
    v_parent_work_item_hidden work_items.hidden%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 소유자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;
    IF v_owner_user_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Owner user does not exist: %', p_owner_user_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 요청자와 소유자 work_item이 속한 노드에 대한 권한 확인
    IF v_requester_id = v_owner_user_id THEN
        -- 본인 업무 생성 권한 확인
        IF NOT check_authority_with_override(v_requester_id, p_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', p_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        -- 타인에게 업무 배정 권한 확인
        IF NOT check_authority_with_override(v_requester_id, p_owner_node_id, 'WI_ASSIGN') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_ASSIGN permission on node: %', p_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
        -- 소유자의 업무 수락 권한 확인
        IF NOT check_authority_with_override(v_owner_user_id, p_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Owner does not have WI_PERSONAL_CHANGE permission on node: %', p_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. work_item이 hidden 속성이 있는 경우 권한 확인
    IF p_hidden THEN
        IF NOT check_authority_with_override(v_requester_id, p_owner_node_id, 'WI_HIDDEN_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_HIDDEN_CHANGE permission on node: %', p_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
        IF NOT check_authority_with_override(v_owner_user_id, p_owner_node_id, 'WI_HIDDEN_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Owner does not have WI_HIDDEN_CHANGE permission on node: %', p_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 5. 부모 work_item이 있을 경우 권한 확인
    IF p_parent_work_item_id IS NOT NULL AND p_parent_work_item_id <> '' THEN
        SELECT owner_node_id, hidden INTO v_parent_work_item_owner_node_id, v_parent_work_item_hidden 
        FROM work_items WHERE work_item_id = p_parent_work_item_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION '[P0601]Parent work item does not exist: %', p_parent_work_item_id
            USING ERRCODE = 'P0601';
        END IF;

        -- 부모 업무가 hidden일 경우 조회 권한 확인
        IF v_parent_work_item_hidden THEN
            IF NOT check_authority_with_override(v_requester_id, v_parent_work_item_owner_node_id, 'WI_HIDDEN_VIEW') THEN
                RAISE EXCEPTION '[P0103]Requester does not have WI_HIDDEN_VIEW permission on parent node: %', v_parent_work_item_owner_node_id
                USING ERRCODE = 'P0103';
            END IF;
        END IF;

        -- 부모 업무 노드에서 하위 업무 생성 권한 확인
        IF NOT check_authority_with_override(v_requester_id, v_parent_work_item_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on parent node: %', v_parent_work_item_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 6. work_item 생성
    INSERT INTO work_items (
        work_item_id, 
        owner_node_id, 
        owner_user_id, 
        title, 
        parent_work_item_id, 
        description, 
        hidden,
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
        COALESCE(p_hidden, FALSE),
        COALESCE(NULLIF(p_status, ''), 'todo'),
        COALESCE(p_priority, 3),
        COALESCE(p_weight, 1),
        COALESCE(p_progress, 0),
        NULLIF(p_start_date, '')::DATE,
        NULLIF(p_due_date, '')::DATE
    );

    -- 7. 생성된 work_item 반환
    RETURN QUERY
    SELECT
        'WORK_ITEM'::TEXT,
        w.work_item_id::TEXT,
        w.hidden::TEXT,
        w.owner_node_id::TEXT,
        w.title::TEXT,
        w.status::TEXT,
        w.priority::INTEGER,
        w.parent_work_item_id::TEXT,
        w.updated_at::TEXT
    FROM work_items w
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN SQLSTATE 'P0601' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0602]Failed to create work item: %', SQLERRM
        USING ERRCODE = 'P0602';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::updateWorkItem
CREATE OR REPLACE FUNCTION update_work_item(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_title work_items.title%TYPE DEFAULT NULL,
    p_description work_items.description%TYPE DEFAULT NULL,
    p_hidden work_items.hidden%TYPE DEFAULT NULL,
    p_status work_items.status%TYPE DEFAULT NULL,
    p_priority work_items.priority%TYPE DEFAULT -1,
    p_weight work_items.weight%TYPE DEFAULT -1,
    p_progress work_items.progress%TYPE DEFAULT -1,
    p_start_date VARCHAR DEFAULT NULL,
    p_due_date VARCHAR DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id  users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_owner_user_email users.email%TYPE;
    v_current_hidden work_items.hidden%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. work_item 정보 한 번에 가져오기 (성능 최적화)
    SELECT owner_node_id, owner_user_id, hidden 
    INTO v_owner_node_id, v_owner_user_id, v_current_hidden 
    FROM work_items 
    WHERE work_item_id = p_work_item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Work item does not exist: %', p_work_item_id
        USING ERRCODE = 'P0603';
    END IF;

    -- 3. 요청자의 권한 확인
    IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %, requester: %', v_owner_node_id, p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 다른 사용자의 work_item 변경 권한 확인 (소유자가 다를 경우)
    IF v_owner_user_id != v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_OTHERS_CHANGE permission on node: %, requester: %', v_owner_node_id, p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 5. 숨김 속성 변경 권한 확인
    IF v_current_hidden THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_HIDDEN_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_HIDDEN_CHANGE permission on node: %, requester: %', v_owner_node_id, p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 6. owner_user_id가 숨김 속성 권한이 없을때, 숨김 속성 true 변경 불가
    IF p_hidden = TRUE AND NOT check_authority_with_override(v_owner_user_id, v_owner_node_id, 'WI_HIDDEN_CHANGE') THEN
        SELECT email INTO v_owner_user_email FROM users WHERE user_id = v_owner_user_id;
        RAISE EXCEPTION '[P0103]Owner does not have WI_HIDDEN_CHANGE permission on node: %, requester: %', v_owner_user_email, p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 7. work_item 업데이트
    UPDATE work_items
    SET
        title = COALESCE(NULLIF(p_title, ''), title),
        description = COALESCE(NULLIF(p_description, ''), description),
        hidden = COALESCE(p_hidden, hidden),
        status = COALESCE(NULLIF(p_status, ''), status),
        priority = CASE WHEN p_priority >= 1 AND p_priority <= 5 THEN p_priority ELSE priority END,
        weight = CASE WHEN p_weight >= 0 THEN p_weight ELSE weight END,
        progress = CASE WHEN p_progress >= 0 AND p_progress <= 100 THEN p_progress ELSE progress END,
        start_date = COALESCE(NULLIF(p_start_date, '')::DATE, start_date),
        due_date = COALESCE(NULLIF(p_due_date, '')::DATE, due_date)
    WHERE work_item_id = p_work_item_id;

    -- 8. 업데이트된 work_item 반환
    RETURN QUERY
    SELECT
        'WORK_ITEM'::TEXT,
        w.work_item_id::TEXT,
        w.hidden::TEXT,
        w.owner_node_id::TEXT,
        w.title::TEXT,
        w.status::TEXT,
        w.priority::INTEGER,
        w.parent_work_item_id::TEXT,
        w.updated_at::TEXT
    FROM work_items w
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN SQLSTATE 'P0603' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0604]Failed to update work item: %', SQLERRM
        USING ERRCODE = 'P0604';
END;
$$ LANGUAGE plpgsql;