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

    -- 6.5 최근 활동 피드 로깅
    PERFORM log_activity(p_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, p_title, 'inserted');

    -- 7. 생성된 work_item 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'parent_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        'title', w.title,
        'description', w.description,
        'status', w.status,
        'priority', w.priority,
        'hidden', w.hidden,
        'weight', w.weight,
        'progress', w.progress,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'updated_at', w.updated_at
    )
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
    v_old_title work_items.title%TYPE;
    v_old_status work_items.status%TYPE;
    v_old_progress work_items.progress%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. work_item 정보 한 번에 가져오기 (성능 최적화)
    SELECT owner_node_id, owner_user_id, hidden, title, status, progress
    INTO v_owner_node_id, v_owner_user_id, v_current_hidden, v_old_title, v_old_status, v_old_progress
    FROM work_items 
    WHERE work_item_id = p_work_item_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Work item does not exist or already deleted: %', p_work_item_id
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

    -- 7.5 활동 로그 적재 (제목, 상태, 진행률 변경 시 기록)
    IF p_title <> '' AND p_title <> v_old_title THEN
        PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, p_title, 'updated', 'title', v_old_title, p_title);
    END IF;
    IF p_status <> '' AND p_status <> v_old_status THEN
        PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, COALESCE(p_title, v_old_title), 'updated', 'status', v_old_status, p_status);
    END IF;
    IF p_progress >= 0 AND p_progress <> v_old_progress THEN
        PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, COALESCE(p_title, v_old_title), 'updated', 'progress', v_old_progress::VARCHAR, p_progress::VARCHAR);
    END IF;

    -- 8. 업데이트된 work_item 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'parent_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        'title', w.title,
        'description', w.description,
        'status', w.status,
        'priority', w.priority,
        'hidden', w.hidden,
        'weight', w.weight,
        'progress', w.progress,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'updated_at', w.updated_at
    )
    FROM work_items w
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
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


-- WorkItemController::deleteWorkItem (Soft Delete)
CREATE OR REPLACE FUNCTION delete_work_item(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_title work_items.title%TYPE;
    v_hidden work_items.hidden%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 업무 존재 여부 확인 및 정보 수집
    SELECT owner_node_id, owner_user_id, title, hidden 
    INTO v_owner_node_id, v_owner_user_id, v_title, v_hidden 
    FROM work_items 
    WHERE work_item_id = p_work_item_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0603]Work item does not exist or already deleted: %', p_work_item_id
        USING ERRCODE = 'P0603';
    END IF;

    -- 3. 권한 체크 (1) 숨김 속성인 경우 처리 권한 검증
    IF v_hidden THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_HIDDEN_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_HIDDEN_CHANGE permission on node: %', v_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 3. 권한 체크 (2) 타인의 업무인 경우 처리 권한 검증
    IF v_owner_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_OTHERS_CHANGE permission on node: %', v_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    -- 3. 권한 체크 (3) 본인 업무인 경우 처리 권한 검증
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', v_owner_node_id
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 업무 소프트 딜리트 처리 (트리거가 동작하여 하위 모든 자식 업무들도 자동 소프트 딜리트됨)
    UPDATE work_items
    SET is_deleted = TRUE
    WHERE work_item_id = p_work_item_id;

    -- 5. 최근 활동 피드 로깅
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, v_title, 'deleted');

    -- 6. 결과 반환 (클라이언트 싱크용)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'status', 'deleted',
        'updated_at', w.updated_at
    )::jsonb
    FROM work_items w
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0603' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0605]Failed to delete work item: %, (REASON: %)', p_work_item_id, SQLERRM
        USING ERRCODE = 'P0605';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::addComment
CREATE OR REPLACE FUNCTION add_work_item_comment(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_content TEXT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_new_comment_id INT;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 업무 존재 여부 확인 및 노드 정보 가져오기
    SELECT w.owner_node_id INTO v_owner_node_id FROM work_items w WHERE w.work_item_id = p_work_item_id AND w.is_deleted = FALSE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0606]Work item does not exist or already deleted: %', p_work_item_id
        USING ERRCODE = 'P0606';
    END IF;

    -- 3. 권한 체크 (해당 노드에 MEMBER 권한 이상 보유하고 있는지 확인)
    IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions to comment on this node. requester: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 댓글 인서트
    INSERT INTO work_item_comments (work_item_id, author_user_id, content)
    VALUES (p_work_item_id, v_requester_id, p_content)
    RETURNING comment_id INTO v_new_comment_id;

    -- 4.5 최근 활동 피드 로깅
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'COMMENT', v_new_comment_id::VARCHAR, 'Comment on ' || p_work_item_id, 'inserted');

    -- 5. 생성 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'comment_id', c.comment_id,
        'work_item_id', c.work_item_id,
        'author_user_id', c.author_user_id,
        'author_name', u.name,
        'author_email', u.email,
        'content', c.content,
        'created_at', c.created_at
    )::jsonb AS out_data
    FROM work_item_comments c
    JOIN users u ON c.author_user_id = u.user_id
    WHERE c.comment_id = v_new_comment_id;
END;
$$ LANGUAGE plpgsql;


-- WorkItemController::addCommentMention
CREATE OR REPLACE FUNCTION add_comment_mention(
    p_comment_id INT,
    p_mentioned_email VARCHAR(100)
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_mentioned_user_id users.user_id%TYPE;
    v_new_mention_id INT;
BEGIN
    -- 멘션 대상 사용자 존재 여부 조회
    SELECT user_id INTO v_mentioned_user_id FROM users WHERE email = p_mentioned_email AND is_deleted = FALSE;
    IF v_mentioned_user_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Mentioned target user does not exist: %', p_mentioned_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 멘션 레코드 인서트
    INSERT INTO comment_mentions (comment_id, mentioned_user_id)
    VALUES (p_comment_id, v_mentioned_user_id)
    RETURNING comment_mentions.mention_id INTO v_new_mention_id;

    -- 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'mention_id', m.mention_id,
        'comment_id', m.comment_id,
        'mentioned_user_id', m.mentioned_user_id,
        'mentioned_user_name', u.name,
        'mentioned_user_email', u.email
    )::jsonb AS out_data
    FROM comment_mentions m
    JOIN users u ON m.mentioned_user_id = u.user_id
    WHERE m.mention_id = v_new_mention_id;
END;
$$ LANGUAGE plpgsql;