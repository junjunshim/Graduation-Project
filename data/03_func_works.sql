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
    p_category work_items.category%TYPE DEFAULT NULL,
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
        category,
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
        NULLIF(p_category, ''),
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
        'category', w.category,
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
    p_category work_items.category%TYPE DEFAULT NULL,
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
    v_old_category work_items.category%TYPE;
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
    SELECT owner_node_id, owner_user_id, hidden, title, category, status, progress
    INTO v_owner_node_id, v_owner_user_id, v_current_hidden, v_old_title, v_old_category, v_old_status, v_old_progress
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
        category = CASE WHEN p_category IS NOT NULL THEN NULLIF(p_category, '') ELSE category END,
        hidden = COALESCE(p_hidden, hidden),
        status = COALESCE(NULLIF(p_status, ''), status),
        priority = CASE WHEN p_priority >= 1 AND p_priority <= 5 THEN p_priority ELSE priority END,
        weight = CASE WHEN p_weight >= 0 THEN p_weight ELSE weight END,
        progress = CASE WHEN p_progress >= 0 AND p_progress <= 100 THEN p_progress ELSE progress END,
        start_date = COALESCE(NULLIF(p_start_date, '')::DATE, start_date),
        due_date = COALESCE(NULLIF(p_due_date, '')::DATE, due_date)
    WHERE work_item_id = p_work_item_id;

    -- 7.5 활동 로그 적재 (제목, 카테고리, 상태, 진행률 변경 시 기록)
    IF p_title <> '' AND p_title <> v_old_title THEN
        PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, p_title, 'updated', 'title', v_old_title, p_title);
    END IF;
    IF p_category IS NOT NULL AND p_category <> COALESCE(v_old_category, '') THEN
        PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, COALESCE(p_title, v_old_title), 'updated', 'category', v_old_category, p_category);
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
        'category', w.category,
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

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0606' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0607]Failed to add comment: %, (REASON: %)', p_work_item_id, SQLERRM
            USING ERRCODE = 'P0607';
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
        'target_email', u.email,
        'type', 'NOTIFICATION',
        'sub_type', 'MENTION',
        'work_item_id', c.work_item_id,
        'comment_id', m.comment_id,
        'mention_id', m.mention_id,
        'mentioned_user_id', m.mentioned_user_id,
        'mentioned_user_name', u.name
    )::jsonb AS out_data
    FROM comment_mentions m
    JOIN work_item_comments c ON m.comment_id = c.comment_id
    JOIN users u ON m.mentioned_user_id = u.user_id
    WHERE m.mention_id = v_new_mention_id;

    EXCEPTION
        WHEN SQLSTATE 'P0002' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0608]Failed to add comment mention for: %, (REASON: %)', p_mentioned_email, SQLERRM
            USING ERRCODE = 'P0608';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::getWorkItemDetail
CREATE OR REPLACE FUNCTION get_work_item_detail(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_hidden BOOLEAN;
    v_authority BIT(24);
    
    -- 권한 비트 상수 캐싱용
    v_node_info_view BIT(24);
    v_wi_public_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_file_view BIT(24);
    v_can_view_files BOOLEAN := FALSE;
BEGIN
    -- 0. 권한 상수 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'FILE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO v_node_info_view, v_wi_public_view, v_wi_hidden_view, v_file_view
    FROM authority_constants
    WHERE name IN ('NODE_INFO_VIEW', 'WI_PUBLIC_VIEW', 'WI_HIDDEN_VIEW', 'FILE_VIEW');

    -- 1. 요청자 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 업무 조회 및 소유자, 노드, 숨김 상태 확인 (삭제된 업무도 조회 가능)
    SELECT owner_node_id, owner_user_id, hidden INTO v_owner_node_id, v_owner_user_id, v_hidden
    FROM work_items 
    WHERE work_item_id = p_work_item_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0606]Work item does not exist: %', p_work_item_id
        USING ERRCODE = 'P0606';
    END IF;

    -- 3. 권한 대조
    v_authority := get_effective_authority(v_requester_id, v_owner_node_id);

    IF v_owner_user_id <> v_requester_id THEN
        -- 노드 보기 권한조차 없는 경우 거부
        IF (v_authority & v_node_info_view) != v_node_info_view THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view node info. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        -- 숨김(hidden) 업무인데 숨김 보기 권한이 없는 경우 거부
        IF v_hidden = TRUE AND (v_authority & v_wi_hidden_view) != v_wi_hidden_view THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view hidden work items. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        -- 일반 업무인데 공개 업무 보기 권한이 없는 경우 거부
        IF v_hidden = FALSE AND (v_authority & v_wi_public_view) != v_wi_public_view THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view public work items. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 파일 조회 권한(FILE_VIEW) 검사 (소유자이거나 FILE_VIEW 권한 비트가 켜져 있는 경우)
    IF v_owner_user_id = v_requester_id OR (v_authority & v_file_view) = v_file_view THEN
        v_can_view_files := TRUE;
    END IF;

    -- 4. 업무 상세(모든 필드)와 결합된 댓글/파일 리스트 취합하여 JSON 형식으로 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM_DETAIL',
        'work_item_id', w.work_item_id,
        'parent_work_item_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        'owner_user_email', u_owner.email,
        'owner_user_name', u_owner.name,
        'title', w.title,
        'description', w.description,
        'category', w.category,
        'status', w.status,
        'priority', w.priority,
        'weight', w.weight,
        'progress', w.progress,
        'hidden', w.hidden,
        'is_deleted', w.is_deleted,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'created_at', w.created_at,
        'updated_at', w.updated_at,
        'comments', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'comment_id', c.comment_id,
                        'author_user_id', c.author_user_id,
                        'author_name', u_author.name,
                        'author_email', u_author.email,
                        'content', c.content,
                        'created_at', c.created_at
                    ) ORDER BY c.created_at ASC
                )
                FROM work_item_comments c
                JOIN users u_author ON c.author_user_id = u_author.user_id
                WHERE c.work_item_id = w.work_item_id
            ), '[]'::jsonb
        ),
        'files', CASE WHEN v_can_view_files THEN
            COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'file_id', f.file_id,
                            'uploader_user_id', f.uploader_user_id,
                            'uploader_name', u_uploader.name,
                            'uploader_email', u_uploader.email,
                            'original_file_name', f.original_file_name,
                            'file_size', f.file_size,
                            'mime_type', f.mime_type,
                            'is_deleted', f.is_deleted,
                            'created_at', f.created_at
                        ) ORDER BY f.created_at ASC
                    )
                    FROM work_item_files f
                    JOIN users u_uploader ON f.uploader_user_id = u_uploader.user_id
                    WHERE f.work_item_id = w.work_item_id
                ), '[]'::jsonb
            )
        ELSE '[]'::jsonb END
    )::jsonb AS out_data
    FROM work_items w
    JOIN users u_owner ON w.owner_user_id = u_owner.user_id
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0606' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0609]Failed to get work item detail: %, (REASON: %)', p_work_item_id, SQLERRM
            USING ERRCODE = 'P0609';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::addWorkItemFile
CREATE OR REPLACE FUNCTION add_work_item_file(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_original_file_name VARCHAR(255),
    p_stored_file_name VARCHAR(255),
    p_file_path TEXT,
    p_file_size BIGINT,
    p_mime_type VARCHAR(100) DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_hidden BOOLEAN;
    v_new_file_id INT;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 업무 존재 여부 확인 및 노드 ID 가져오기
    SELECT owner_node_id, owner_user_id, hidden INTO v_owner_node_id, v_owner_user_id, v_hidden
    FROM work_items WHERE work_item_id = p_work_item_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0606]Work item does not exist or already deleted: %', p_work_item_id
        USING ERRCODE = 'P0606';
    END IF;

    -- 3. 업무 접근 권한 및 파일 변경 권한(FILE_CHANGE) 검증
    IF v_owner_user_id <> v_requester_id THEN
        IF v_hidden = TRUE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_HIDDEN_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to access hidden work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF v_hidden = FALSE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PUBLIC_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to access public work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to upload file on this node. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 파일 메타데이터 인서트
    INSERT INTO work_item_files (work_item_id, uploader_user_id, original_file_name, stored_file_name, file_path, file_size, mime_type)
    VALUES (p_work_item_id, v_requester_id, p_original_file_name, p_stored_file_name, p_file_path, p_file_size, p_mime_type)
    RETURNING file_id INTO v_new_file_id;

    -- 5. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', v_new_file_id::VARCHAR, 'Uploaded file: ' || p_original_file_name, 'inserted');

    -- 6. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'file_id', f.file_id,
        'work_item_id', f.work_item_id,
        'uploader_user_id', f.uploader_user_id,
        'uploader_name', u.name,
        'uploader_email', u.email,
        'original_file_name', f.original_file_name,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'created_at', f.created_at
    )::jsonb AS out_data
    FROM work_item_files f
    JOIN users u ON f.uploader_user_id = u.user_id
    WHERE f.file_id = v_new_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0606' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0610]Failed to add work item file: %, (REASON: %)', p_original_file_name, SQLERRM
            USING ERRCODE = 'P0610';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::deleteWorkItemFile
CREATE OR REPLACE FUNCTION delete_work_item_file(
    p_requester_email users.email%TYPE,
    p_file_id INT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_uploader_user_id users.user_id%TYPE;
    v_work_item_id work_items.work_item_id%TYPE;
    v_original_file_name VARCHAR(255);
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 파일 존재 여부 및 관련 노드/업로더 확인
    SELECT f.uploader_user_id, f.work_item_id, f.original_file_name, w.owner_node_id
    INTO v_uploader_user_id, v_work_item_id, v_original_file_name, v_owner_node_id
    FROM work_item_files f
    JOIN work_items w ON f.work_item_id = w.work_item_id
    WHERE f.file_id = p_file_id AND f.is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist or already deleted: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 권한 체크 (업로더 본인이거나 노드의 FILE_CHANGE 권한 보유 확인)
    IF v_uploader_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete file on this node. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 소프트 딜리트
    UPDATE work_item_files
    SET is_deleted = TRUE
    WHERE file_id = p_file_id;

    -- 5. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', p_file_id::VARCHAR, 'Deleted file: ' || v_original_file_name, 'deleted');

    -- 6. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'file_id', p_file_id,
        'work_item_id', v_work_item_id,
        'is_deleted', TRUE
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0611]Failed to delete work item file: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0611';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::getWorkItemFiles
CREATE OR REPLACE FUNCTION get_work_item_files(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_hidden BOOLEAN;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 업무 존재 여부 확인 및 노드 ID 가져오기
    SELECT owner_node_id, owner_user_id, hidden INTO v_owner_node_id, v_owner_user_id, v_hidden
    FROM work_items WHERE work_item_id = p_work_item_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0606]Work item does not exist or already deleted: %', p_work_item_id
        USING ERRCODE = 'P0606';
    END IF;

    -- 3. 업무 접근 권한 및 파일 조회 권한(FILE_VIEW) 검증
    IF v_owner_user_id <> v_requester_id THEN
        IF v_hidden = TRUE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_HIDDEN_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view hidden work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF v_hidden = FALSE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PUBLIC_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view public work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view files on this node. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 파일 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'file_id', f.file_id,
        'work_item_id', f.work_item_id,
        'uploader_user_id', f.uploader_user_id,
        'uploader_name', u.name,
        'uploader_email', u.email,
        'original_file_name', f.original_file_name,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'created_at', f.created_at
    )::jsonb AS out_data
    FROM work_item_files f
    JOIN users u ON f.uploader_user_id = u.user_id
    WHERE f.work_item_id = p_work_item_id AND f.is_deleted = FALSE
    ORDER BY f.created_at ASC;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0606' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0612]Failed to fetch work item files: %, (REASON: %)', p_work_item_id, SQLERRM
            USING ERRCODE = 'P0612';
END;
$$ LANGUAGE plpgsql;

-- WorkItemController::getWorkItemFileDownload (다운로드 시 실제 경로 및 권한 검증용)
CREATE OR REPLACE FUNCTION get_work_item_file_download(
    p_requester_email users.email%TYPE,
    p_file_id INT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_hidden BOOLEAN;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 파일 및 연관 업무/노드 확인
    SELECT w.owner_node_id, w.owner_user_id, w.hidden INTO v_owner_node_id, v_owner_user_id, v_hidden
    FROM work_item_files f
    JOIN work_items w ON f.work_item_id = w.work_item_id
    WHERE f.file_id = p_file_id AND f.is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist or already deleted: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 업무 접근 권한 및 파일 다운로드 권한(FILE_VIEW) 검증
    IF v_owner_user_id <> v_requester_id THEN
        IF v_hidden = TRUE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_HIDDEN_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to access hidden work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF v_hidden = FALSE AND NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PUBLIC_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to access public work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;

        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to download file. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 4. 파일 상세 경로 및 메타데이터 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'file_id', f.file_id,
        'work_item_id', f.work_item_id,
        'original_file_name', f.original_file_name,
        'stored_file_name', f.stored_file_name,
        'file_path', f.file_path,
        'file_size', f.file_size,
        'mime_type', f.mime_type
    )::jsonb AS out_data
    FROM work_item_files f
    WHERE f.file_id = p_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0613]Failed to get work item file download: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0613';
END;
$$ LANGUAGE plpgsql;


-- WorkItemController::restoreWorkItem (선택적 / 일괄 복구 + 부모 변경 복구 지원)
CREATE OR REPLACE FUNCTION restore_work_item(
    p_requester_email users.email%TYPE,
    p_work_item_id work_items.work_item_id%TYPE,
    p_new_parent_id work_items.parent_work_item_id%TYPE DEFAULT NULL,
    p_cascade BOOLEAN DEFAULT FALSE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_parent_id work_items.parent_work_item_id%TYPE;
    v_title work_items.title%TYPE;
    v_effective_parent_id work_items.parent_work_item_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 업무 확인 (삭제된 업무)
    SELECT owner_node_id, owner_user_id, parent_work_item_id, title
    INTO v_owner_node_id, v_owner_user_id, v_parent_id, v_title
    FROM work_items
    WHERE work_item_id = p_work_item_id AND is_deleted = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0606]Work item does not exist in deleted items: %', p_work_item_id
        USING ERRCODE = 'P0606';
    END IF;

    -- 3. 소속 노드 생존 여부 검증 (노드가 살아있어야 업무 복구 가능)
    IF EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = v_owner_node_id AND is_deleted = TRUE) THEN
        RAISE EXCEPTION '[P0614]Cannot restore work item because its owner node is still deleted. Node ID: %', v_owner_node_id
        USING ERRCODE = 'P0614';
    END IF;

    -- 4. 부모 업무 생존 여부 검증 및 새 부모 설정
    IF p_new_parent_id IS NOT NULL AND p_new_parent_id != '' THEN
        -- 새로운 부모가 정상 생존해 있는지 확인
        IF NOT EXISTS (SELECT 1 FROM work_items WHERE work_item_id = p_new_parent_id AND is_deleted = FALSE) THEN
            RAISE EXCEPTION '[P0615]Specified new parent work item does not exist or is deleted: %', p_new_parent_id
            USING ERRCODE = 'P0615';
        END IF;
        v_effective_parent_id := p_new_parent_id;
    ELSE
        -- 기존 부모가 있는 경우, 기존 부모가 삭제 상태인지 확인
        IF v_parent_id IS NOT NULL THEN
            IF EXISTS (SELECT 1 FROM work_items WHERE work_item_id = v_parent_id AND is_deleted = TRUE) THEN
                RAISE EXCEPTION '[P0616]Cannot restore work item because its parent work item is still deleted. Please specify a new parent or restore the parent first. Parent ID: %', v_parent_id
                USING ERRCODE = 'P0616';
            END IF;
        END IF;
        v_effective_parent_id := v_parent_id;
    END IF;

    -- 5. 권한 체크 (WI_PERSONAL_CHANGE 또는 WI_OTHERS_CHANGE)
    IF v_owner_user_id = v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_PERSONAL_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore personal work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'WI_OTHERS_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore other user work item. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 6. 복구 수행
    UPDATE work_items
    SET is_deleted = FALSE,
        parent_work_item_id = v_effective_parent_id
    WHERE work_item_id = p_work_item_id;

    -- 6-1. 일괄 복구(cascade = TRUE)인 경우: 하위 하위 업무 및 첨부파일 함께 복구
    IF p_cascade = TRUE THEN
        -- 하위 모든 하위 업무 재귀적 복구 (CTE 활용)
        WITH RECURSIVE descendants AS (
            SELECT work_item_id FROM work_items WHERE parent_work_item_id = p_work_item_id
            UNION ALL
            SELECT w.work_item_id FROM work_items w
            JOIN descendants d ON w.parent_work_item_id = d.work_item_id
        )
        UPDATE work_items
        SET is_deleted = FALSE
        WHERE work_item_id IN (SELECT work_item_id FROM descendants) AND is_deleted = TRUE;

        -- 소속 첨부파일들 복구
        WITH RECURSIVE all_restored_wi AS (
            SELECT p_work_item_id as work_item_id
            UNION ALL
            SELECT w.work_item_id FROM work_items w
            JOIN all_restored_wi rw ON w.parent_work_item_id = rw.work_item_id
        )
        UPDATE work_item_files
        SET is_deleted = FALSE
        WHERE work_item_id IN (SELECT work_item_id FROM all_restored_wi) AND is_deleted = TRUE;
    END IF;

    -- 7. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'WORK_ITEM', p_work_item_id, v_title, 'restored');

    -- 8. 복구된 업무 반환
    RETURN QUERY
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
    LEFT JOIN (
        SELECT work_item_id, COUNT(*)::INT as cnt
        FROM work_item_comments
        GROUP BY work_item_id
    ) cc ON w.work_item_id = cc.work_item_id
    WHERE w.work_item_id = p_work_item_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0606' OR SQLSTATE 'P0614' OR SQLSTATE 'P0615' OR SQLSTATE 'P0616' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0617]Failed to restore work item: %, (REASON: %)', p_work_item_id, SQLERRM
            USING ERRCODE = 'P0617';
END;
$$ LANGUAGE plpgsql;


-- WorkItemController::restoreWorkItemFile
CREATE OR REPLACE FUNCTION restore_work_item_file(
    p_requester_email users.email%TYPE,
    p_file_id INT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_node_id organization_nodes.node_id%TYPE;
    v_uploader_user_id users.user_id%TYPE;
    v_work_item_id work_items.work_item_id%TYPE;
    v_original_file_name VARCHAR(255);
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 파일 확인 (삭제된 파일)
    SELECT f.uploader_user_id, f.work_item_id, f.original_file_name, w.owner_node_id
    INTO v_uploader_user_id, v_work_item_id, v_original_file_name, v_owner_node_id
    FROM work_item_files f
    JOIN work_items w ON f.work_item_id = w.work_item_id
    WHERE f.file_id = p_file_id AND f.is_deleted = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]File does not exist in deleted items: %', p_file_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 소속 업무 생존 여부 검증 (업무가 살아있어야 파일 복구 가능)
    IF EXISTS (SELECT 1 FROM work_items WHERE work_item_id = v_work_item_id AND is_deleted = TRUE) THEN
        RAISE EXCEPTION '[P0618]Cannot restore file because its work item is still deleted. Work item ID: %', v_work_item_id
        USING ERRCODE = 'P0618';
    END IF;

    -- 4. 권한 체크 (업로더 본인이거나 FILE_CHANGE 권한 보유)
    IF v_uploader_user_id <> v_requester_id THEN
        IF NOT check_authority_with_override(v_requester_id, v_owner_node_id, 'FILE_CHANGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to restore file on this node. requester: %', p_requester_email
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 5. 복구 수행
    UPDATE work_item_files
    SET is_deleted = FALSE
    WHERE file_id = p_file_id;

    -- 6. 활동 로그 기록
    PERFORM log_activity(v_owner_node_id, p_requester_email, 'FILE', p_file_id::VARCHAR, 'Restored file: ' || v_original_file_name, 'restored');

    -- 7. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'FILE',
        'id', f.file_id,
        'work_item_id', f.work_item_id,
        'uploader_user_id', f.uploader_user_id,
        'uploader_name', u.name,
        'uploader_email', u.email,
        'original_file_name', f.original_file_name,
        'file_size', f.file_size,
        'mime_type', f.mime_type,
        'is_deleted', f.is_deleted,
        'created_at', f.created_at,
        'updated_at', f.updated_at
    )
    FROM work_item_files f
    JOIN users u ON f.uploader_user_id = u.user_id
    WHERE f.file_id = p_file_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0618' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0619]Failed to restore work item file: %, (REASON: %)', p_file_id, SQLERRM
            USING ERRCODE = 'P0619';
END;
$$ LANGUAGE plpgsql;


-- Cron/Scheduler::cleanup_expired_deleted_data (15일 지난 삭제 데이터 하드 딜리트 및 파일 경로 반환)
CREATE OR REPLACE FUNCTION cleanup_expired_deleted_data()
RETURNS TABLE (deleted_file_path VARCHAR(500)) AS $$
BEGIN
    -- 1. 15일 이상 지난 삭제 대상 파일들의 실제 물리 경로 수집하여 반환 테이블에 적재
    RETURN QUERY
    SELECT f.file_path
    FROM work_item_files f
    WHERE f.is_deleted = TRUE 
      AND f.updated_at < (CURRENT_TIMESTAMP - INTERVAL '15 days')
      AND f.file_path IS NOT NULL AND f.file_path <> '';

    -- 2. 15일 지난 파일 DB 레코드 영구 삭제
    DELETE FROM work_item_files
    WHERE is_deleted = TRUE 
      AND updated_at < (CURRENT_TIMESTAMP - INTERVAL '15 days');

    -- 3. 15일 지난 업무 DB 레코드 영구 삭제 (연관 댓글, 멘션, 파일은 ON DELETE CASCADE로 함께 영구 삭제)
    DELETE FROM work_items
    WHERE is_deleted = TRUE 
      AND updated_at < (CURRENT_TIMESTAMP - INTERVAL '15 days');

    -- 4. 15일 지난 노드 DB 레코드 영구 삭제 (연관 역할, 권한, 업무는 ON DELETE CASCADE로 함께 영구 삭제)
    DELETE FROM organization_nodes
    WHERE is_deleted = TRUE 
      AND updated_at < (CURRENT_TIMESTAMP - INTERVAL '15 days');

END;
$$ LANGUAGE plpgsql;