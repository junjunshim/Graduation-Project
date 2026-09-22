-- 컨트롤러에서 사용될 organization_nodes 관련 함수 생성

-- OrgController::createTopNode
CREATE OR REPLACE FUNCTION create_top_node(
    p_email users.email%TYPE,
    p_node_type organization_nodes.node_type%TYPE,
    p_name organization_nodes.name%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_new_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 1. 유저 존재 여부 확인 및 id 가져오기
    SELECT user_id INTO v_user_id FROM users WHERE email = p_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]User does not exist : %', p_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 생성
    INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
    VALUES (
        p_node_type,
        NULL,
        p_name,
        '{}'::INTEGER[]
    ) RETURNING node_id INTO v_new_node_id;

     -- 3. 생성된 노드의 path 업데이트 (자기 자신을 포함)
    UPDATE organization_nodes
    SET path = ARRAY[v_new_node_id]
    WHERE node_id = v_new_node_id;

    -- 3. 소유자 배정 (role_assignments 테이블)
    PERFORM default_node_authority(v_new_node_id);
    INSERT INTO role_assignments (user_id, node_id, role_id)
    SELECT v_user_id, v_new_node_id, authority_id FROM role_authorities
    WHERE node_id = v_new_node_id AND is_top_role;

    -- 4.5 최근 활동 피드 로깅
    PERFORM log_activity(v_new_node_id, p_email, 'NODE', v_new_node_id::VARCHAR, p_name, 'inserted');

    -- 5. 생성된 노드관련 정보 즉시 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id

    UNION ALL 

    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = ra.role_id),
        'role_id', ra.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = ra.role_id),
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE a.node_id = v_new_node_id;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0301]Error creating top-node: %, requester: %  (REASON: %)', p_name, p_email, SQLERRM
        USING ERRCODE = 'P0301';
END;
$$ LANGUAGE plpgsql;


-- OrgController::createSubNode
CREATE OR REPLACE FUNCTION create_sub_node(
    p_requester_email users.email%TYPE,
    p_node_type organization_nodes.node_type%TYPE,
    p_parent_node_id organization_nodes.node_id%TYPE,
    p_name organization_nodes.name%TYPE,
    p_owner_user_email users.email%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_owner_user_id users.user_id%TYPE;
    v_new_node_id organization_nodes.node_id%TYPE;
    v_parent_path organization_nodes.path%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 소유자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_owner_user_id FROM users WHERE email = p_owner_user_email;

    IF v_owner_user_id IS NULL THEN
        RAISE EXCEPTION '[P0002]Owner user does not exist : %', p_owner_user_email
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 요청자 권한 확인
    IF NOT check_authority_with_override(v_requester_id, p_parent_node_id, 'NODE_SUB_CREATE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. (sub node creation) for user: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 소유자 권한 확인 (소유자는 최소 MEMBER 권한 필요)
    IF NOT check_authority_with_override(v_owner_user_id, p_parent_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. (owner user must have at least MEMBER role) for user: %', p_owner_user_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 하위 노드 생성
    SELECT path INTO v_parent_path FROM organization_nodes WHERE node_id = p_parent_node_id;

    INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
    VALUES (
        p_node_type,
        p_parent_node_id,
        p_name,
        '{}'::INTEGER[]
    ) RETURNING node_id INTO v_new_node_id;

    -- 4. 생성된 노드의 path 업데이트 (부모 노드의 path + 자기 자신)
    UPDATE organization_nodes
    SET path = v_parent_path || v_new_node_id
    WHERE node_id = v_new_node_id;
    
    -- 5. 소유자 배정 (role_assignments 테이블)
    PERFORM default_node_authority(v_new_node_id);
    INSERT INTO role_assignments (user_id, node_id, role_id)
    SELECT v_owner_user_id, v_new_node_id, authority_id FROM role_authorities
    WHERE node_id = v_new_node_id AND is_top_role;

    -- 6.5 최근 활동 피드 로깅
    PERFORM log_activity(v_new_node_id, p_requester_email, 'NODE', v_new_node_id::VARCHAR, p_name, 'inserted');

    -- 7. 생성된 노드 정보 즉시 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id = v_new_node_id

    UNION ALL

    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = ra.role_id),
        'role_id', ra.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = ra.role_id),
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE a.node_id = v_new_node_id;

    EXCEPTION 
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
        WHEN SQLSTATE 'P0103' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0302]Error creating sub-node: %, requester: %  (REASON: %)', p_name, p_requester_email, SQLERRM
        USING ERRCODE = 'P0302';
END;
$$ LANGUAGE plpgsql;

-- OrgController::updateNode
CREATE OR REPLACE FUNCTION update_node(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_name organization_nodes.name%TYPE,
    p_node_type organization_nodes.node_type%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_requester_role role_authorities.role%TYPE;
    v_old_name organization_nodes.name%TYPE;
    v_old_type organization_nodes.node_type%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 1.5 대상 노드 존재 여부 확인 및 변경전 정보 수집
    SELECT name, node_type INTO v_old_name, v_old_type
    FROM organization_nodes
    WHERE node_id = p_node_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Target node does not exist or already deleted: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 2. 요청자 권한 확인
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. (node update) for user: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 3. 노드 업데이트 (naem, node_type 빈 문자열 전달 시 업데이트 안함)
    UPDATE organization_nodes
    SET 
        name = CASE WHEN p_name = '' THEN name ELSE p_name END,
        node_type = CASE WHEN p_node_type = '' THEN node_type ELSE p_node_type END
    WHERE node_id = p_node_id;

    -- 3.5 활동 로그 적재 (이름이 변경되었거나 타입이 변경되었을 때 로그 남김)
    IF p_name <> '' AND p_name <> v_old_name THEN
        PERFORM log_activity(p_node_id, p_requester_email, 'NODE', p_node_id::VARCHAR, p_name, 'updated', 'name', v_old_name, p_name);
    END IF;
    IF p_node_type <> '' AND p_node_type <> v_old_type THEN
        PERFORM log_activity(p_node_id, p_requester_email, 'NODE', p_node_id::VARCHAR, COALESCE(p_name, v_old_name), 'updated', 'node_type', v_old_type, p_node_type);
    END IF;

    -- 4. 업데이트된 노드 정보 즉시 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'node_type', n.node_type,
        'parent_id', n.parent_node_id,
        'title', n.name,
        'path', n.path,
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id = p_node_id;

    EXCEPTION
    WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' THEN
        RAISE;
    WHEN SQLSTATE 'P0103' THEN
        RAISE;
    WHEN OTHERS THEN
        RAISE EXCEPTION '[P0303]Error updating node: %, requester: %  (REASON: %)', p_node_id, p_requester_email, SQLERRM
        USING ERRCODE = 'P0303';
END;
$$ LANGUAGE plpgsql;


-- OrgController::deleteNode (Soft Delete)
CREATE OR REPLACE FUNCTION delete_node(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_name organization_nodes.name%TYPE;
BEGIN
    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 노드 존재 여부 확인 및 정보 수집
    SELECT name INTO v_node_name FROM organization_nodes WHERE node_id = p_node_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Target node does not exist or already deleted: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 권한 체크: 요청자가 NODE_INFO_CHANGE 권한을 가졌는지 검증 (check_authority_with_override 헬퍼 함수 활용)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions to delete node. NODE_INFO_CHANGE authority required. requester: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 노드 소프트 딜리트 처리 (트리거 작동으로 하위 자식 노드 및 소속 업무 연쇄 삭제됨)
    UPDATE organization_nodes
    SET is_deleted = TRUE
    WHERE node_id = p_node_id;

    -- 5. 최근 활동 피드 로깅
    PERFORM log_activity(p_node_id, p_requester_email, 'NODE', p_node_id::VARCHAR, v_node_name, 'deleted');

    -- 6. 결과 반환 (클라이언트 싱크용)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'NODE',
        'id', n.node_id,
        'status', 'deleted',
        'updated_at', n.updated_at
    )
    FROM organization_nodes n
    WHERE n.node_id = p_node_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0304]Error deleting node: %, requester: % (REASON: %)', p_node_id, p_requester_email, SQLERRM
        USING ERRCODE = 'P0304';
END;
$$ LANGUAGE plpgsql;


-- OrgController::getNodeDetail
CREATE OR REPLACE FUNCTION get_node_detail(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_authority BIT(24);
    
    -- 권한 비트 상수 캐싱용
    v_node_info_view BIT(24);
    v_node_members_view BIT(24);
    v_wi_public_view BIT(24);
    v_wi_hidden_view BIT(24);
    v_file_view BIT(24);
    v_history_personal_view BIT(24);
    v_history_all_view BIT(24);
    v_deny BIT(24);
BEGIN
    -- 0. 권한 상수 로드
    SELECT 
        BIT_OR(CASE WHEN name = 'NODE_INFO_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'NODE_MEMBERS_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_PUBLIC_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'WI_HIDDEN_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'FILE_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_PERSONAL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'HISTORY_ALL_VIEW' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO 
        v_node_info_view, v_node_members_view,
        v_wi_public_view, v_wi_hidden_view, v_file_view,
        v_history_personal_view, v_history_all_view, v_deny
    FROM authority_constants
    WHERE name IN (
        'NODE_INFO_VIEW', 'NODE_MEMBERS_VIEW',
        'WI_PUBLIC_VIEW', 'WI_HIDDEN_VIEW', 'FILE_VIEW',
        'HISTORY_PERSONAL_VIEW', 'HISTORY_ALL_VIEW', 'DENY'
    );

    -- 1. 요청자 id 가져오기 및 존재 여부 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 노드 존재 여부 확인 (삭제된 노드 포함 조회 가능)
    IF NOT EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0002]Target node does not exist: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 유효 권한 계산 및 기본 조회 권한(NODE_INFO_VIEW) 검증
    v_authority := get_effective_authority(v_requester_id, p_node_id);

    IF v_authority IS NULL OR (v_authority & v_deny) = v_deny OR (v_authority & v_node_info_view) != v_node_info_view THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions to view node. NODE_INFO_VIEW authority required. requester: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 통합 데이터 반환
    -- 4-1. 대상 노드 자체 메타데이터 (NODE)
    RETURN QUERY
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
    WHERE n.node_id = p_node_id;

    -- 4-2. 노드 멤버 역할 목록 (ROLE) 및 사용자 정보 (USER) - NODE_MEMBERS_VIEW 권한 보유 시 전체 반환, 없더라도 본인 역할은 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'ROLE',
        'id', ra.assignment_id,
        'node_id', ra.node_id,
        'user_id', ra.user_id,
        'user_name', u.name,
        'email', u.email,
        'role', (SELECT role FROM role_authorities WHERE authority_id = ra.role_id),
        'role_id', ra.role_id,
        'is_top_role', (SELECT is_top_role FROM role_authorities WHERE authority_id = ra.role_id),
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = p_node_id
        AND ((v_authority & v_node_members_view) = v_node_members_view OR ra.user_id = v_requester_id);

    -- NODE_MEMBERS_VIEW 권한 보유 시 또는 본인 사용자 정보 반환
    RETURN QUERY
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
    WHERE ra.node_id = p_node_id AND u.is_deleted = FALSE
        AND ((v_authority & v_node_members_view) = v_node_members_view OR ra.user_id = v_requester_id);

    -- 4-3. 노드 역할별 권한 정의 목록 (AUTHORITY)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
        'role_id', a.authority_id,
        'is_top_role', a.is_top_role,
        'node_id', a.node_id,
        'role', a.role,
        'authority', a.authority::TEXT,
        'updated_at', a.updated_at
    )
    FROM role_authorities a
    WHERE a.node_id = p_node_id;

    -- 4-4. 노드 소속 업무 목록 (WORK_ITEM)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORK_ITEM',
        'id', w.work_item_id,
        'display_id', w.display_id,
        'parent_id', w.parent_work_item_id,
        'owner_node_id', w.owner_node_id,
        'owner_user_id', w.owner_user_id,
        -- 역할 목록에 없는 담당자(퇴장·스코프 밖)도 이름을 표시할 수 있도록 함께 내려준다.
        'owner_user_email', u_owner.email,
        'owner_user_name', u_owner.name,
        'title', w.title,
        'description', w.description,
        'category', w.category,
        'status', w.status,
        'priority', w.priority,
        'hidden', w.hidden,
        'weight', w.weight,
        'progress', w.progress,
        'computed_progress', compute_work_item_progress(w.work_item_id),
        'comment_count', COALESCE(cc.cnt, 0),
        'is_deleted', w.is_deleted,
        'start_date', w.start_date,
        'due_date', w.due_date,
        'updated_at', w.updated_at
    )
    FROM work_items w
    LEFT JOIN users u_owner ON w.owner_user_id = u_owner.user_id
    LEFT JOIN (
        SELECT work_item_id, COUNT(*)::INT as cnt
        FROM work_item_comments
        GROUP BY work_item_id
    ) cc ON w.work_item_id = cc.work_item_id
    WHERE w.owner_node_id = p_node_id
      AND (
          -- 공개 업무
          ((v_authority & v_wi_public_view) = v_wi_public_view AND w.hidden = FALSE)
          OR
          -- 숨김 업무
          ((v_authority & v_wi_hidden_view) = v_wi_hidden_view)
          OR
          -- 본인 담당 업무
          (w.owner_user_id = v_requester_id)
      );

    -- 4-5. 노드 소속 업무에 공유된 파일 목록 (FILE)
    -- 담당자 본인 업무의 파일은 FILE_VIEW 가 없어도 포함한다
    -- (get_initial_context / get_work_item_detail / add_work_item_file 와 동일한 담당자 기준).
    IF (v_authority & v_file_view) = v_file_view
       OR EXISTS (
           SELECT 1 FROM work_items w
           WHERE w.owner_node_id = p_node_id AND w.owner_user_id = v_requester_id
       )
    THEN
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
        JOIN work_items w ON f.work_item_id = w.work_item_id
        JOIN users u ON f.uploader_user_id = u.user_id
        WHERE w.owner_node_id = p_node_id
          AND (
              ((v_authority & v_wi_public_view) = v_wi_public_view AND w.hidden = FALSE)
              OR
              ((v_authority & v_wi_hidden_view) = v_wi_hidden_view)
              OR
              (w.owner_user_id = v_requester_id)
          );
    END IF;

    -- 4-6. 해당 노드에서 일어난 활동 이력 전체 (ACTIVITY)
    IF (v_authority & v_history_all_view) = v_history_all_view THEN
        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'ACTIVITY',
            'id', a.log_id,
            'node_id', a.node_id,
            'actor_user_id', a.actor_user_id,
            'actor_name', u.name,
            'entity_type', a.entity_type,
            'entity_id', a.entity_id,
            'target_name', a.target_name,
            'action_type', a.action_type,
            'field_name', a.field_name,
            'old_value', a.old_value,
            'new_value', a.new_value,
            'created_at', a.created_at
        )
        FROM activity_logs a
        JOIN users u ON a.actor_user_id = u.user_id
        WHERE a.node_id = p_node_id
        ORDER BY a.created_at DESC;
    ELSIF (v_authority & v_history_personal_view) = v_history_personal_view THEN
        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'ACTIVITY',
            'id', a.log_id,
            'node_id', a.node_id,
            'actor_user_id', a.actor_user_id,
            'actor_name', u.name,
            'entity_type', a.entity_type,
            'entity_id', a.entity_id,
            'target_name', a.target_name,
            'action_type', a.action_type,
            'field_name', a.field_name,
            'old_value', a.old_value,
            'new_value', a.new_value,
            'created_at', a.created_at
        )
        FROM activity_logs a
        JOIN users u ON a.actor_user_id = u.user_id
        WHERE a.node_id = p_node_id AND a.actor_user_id = v_requester_id
        ORDER BY a.created_at DESC;
    END IF;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0305]Error retrieving node detail: %, requester: % (REASON: %)', p_node_id, p_requester_email, SQLERRM
            USING ERRCODE = 'P0305';
END;
$$ LANGUAGE plpgsql;


-- OrgController::restoreNode (선택적 / 일괄 복구)
CREATE OR REPLACE FUNCTION restore_node(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_cascade BOOLEAN DEFAULT FALSE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_parent_id organization_nodes.parent_node_id%TYPE;
    v_node_name organization_nodes.name%TYPE;
BEGIN
    -- 1. 요청자 id 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist : %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 대상 노드 확인 (삭제된 노드 대상)
    SELECT parent_node_id, name INTO v_parent_id, v_node_name
    FROM organization_nodes
    WHERE node_id = p_node_id AND is_deleted = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Target node does not exist in deleted items: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 상위 부모 노드 생존 여부 검증 (부모가 살아있어야 복구 가능)
    IF v_parent_id IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = v_parent_id AND is_deleted = TRUE) THEN
            RAISE EXCEPTION '[P0306]Cannot restore node because its parent node is still deleted. Parent node ID: %', v_parent_id
            USING ERRCODE = 'P0306';
        END IF;
    END IF;

    -- 4. 권한 체크 (NODE_INFO_CHANGE 필요)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions to restore node. NODE_INFO_CHANGE authority required. requester: %', p_requester_email
        USING ERRCODE = 'P0103';
    END IF;

    -- 5. 복구 수행
    -- 5-1. 대상 노드 복구
    UPDATE organization_nodes
    SET is_deleted = FALSE
    WHERE node_id = p_node_id;

    -- 5-2. 일괄 복구(cascade = TRUE)인 경우: 모든 후손 노드, 소속 업무, 첨부파일 함께 복구
    IF p_cascade = TRUE THEN
        -- 하위 모든 자식 노드 복구
        UPDATE organization_nodes
        SET is_deleted = FALSE
        WHERE path @> ARRAY[p_node_id] AND is_deleted = TRUE;

        -- 해당 노드 및 하위 모든 노드에 소속된 업무 복구
        UPDATE work_items
        SET is_deleted = FALSE
        WHERE owner_node_id IN (SELECT node_id FROM organization_nodes WHERE path @> ARRAY[p_node_id])
          AND is_deleted = TRUE;

        -- 복구된 업무들에 소속된 첨부파일 복구
        UPDATE work_item_files
        SET is_deleted = FALSE
        WHERE work_item_id IN (
            SELECT work_item_id FROM work_items 
            WHERE owner_node_id IN (SELECT node_id FROM organization_nodes WHERE path @> ARRAY[p_node_id])
        ) AND is_deleted = TRUE;
    END IF;

    -- 6. 활동 로그 기록
    PERFORM log_activity(p_node_id, p_requester_email, 'NODE', p_node_id::VARCHAR, v_node_name, 'restored');

    -- 7. 복구된 노드 데이터 반환
    RETURN QUERY
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
    WHERE n.node_id = p_node_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0306' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0307]Error restoring node: %, requester: % (REASON: %)', p_node_id, p_requester_email, SQLERRM
            USING ERRCODE = 'P0307';
END;
$$ LANGUAGE plpgsql;

-- OrgController::previewNodeMove / moveNode (워크스페이스 이전)
-- Workspace relocation is separate from update_node. Preview never writes data.
-- Resolve authority against a hypothetical path using the same nearest-role override
-- semantics as get_effective_authority (including explicit DENY).
CREATE OR REPLACE FUNCTION check_authority_on_path(
    p_user_id VARCHAR, p_path INTEGER[], p_authority_name VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE v_auth BIT(24);
BEGIN
    SELECT a.authority INTO v_auth
    FROM unnest(p_path) WITH ORDINALITY AS path(node_id, depth)
    JOIN role_assignments r ON r.node_id = path.node_id AND r.user_id = p_user_id
    JOIN role_authorities a ON a.authority_id = r.role_id AND a.node_id = r.node_id
    ORDER BY path.depth DESC LIMIT 1;
    RETURN COALESCE((v_auth & get_bit_position('DENY')) <> get_bit_position('DENY')
        AND (v_auth & get_bit_position(p_authority_name)) = get_bit_position(p_authority_name), FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION build_node_move_preview(
    p_requester_email VARCHAR, p_node_id INTEGER, p_parent_node_id INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_requester VARCHAR;
    v_node organization_nodes%ROWTYPE;
    v_parent organization_nodes%ROWTYPE;
    v_prefix INTEGER[] := '{}';
    v_ids INTEGER[];
    v_scope INTEGER[];
    v_nodes JSONB;
    v_work JSONB;
    v_schedules JSONB;
    v_groups JSONB := '[]';
    v_targets JSONB;
    v_all_targets JSONB;
    v_detached JSONB;
    v_group RECORD;
    v_token TEXT;
BEGIN
    SELECT user_id INTO v_requester FROM users WHERE email = p_requester_email AND NOT is_deleted;
    IF v_requester IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester does not exist' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_node FROM organization_nodes WHERE node_id = p_node_id AND NOT is_deleted;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Workspace does not exist' USING ERRCODE = 'P0002';
    END IF;
    IF NOT check_direct_authority(v_requester, p_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Direct NODE_INFO_CHANGE authority required' USING ERRCODE = 'P0103';
    END IF;
    IF v_node.node_type = 'USER' OR EXISTS (SELECT 1 FROM users WHERE personal_node_id = p_node_id) THEN
        RAISE EXCEPTION '[P0320]Personal workspace cannot be moved' USING ERRCODE = 'P0320';
    END IF;
    IF EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = ANY(v_node.path) AND is_deleted) THEN
        RAISE EXCEPTION '[P0320]Restore the workspace ancestors before moving' USING ERRCODE = 'P0320';
    END IF;
    IF p_parent_node_id IS NOT NULL THEN
        SELECT * INTO v_parent FROM organization_nodes WHERE node_id = p_parent_node_id AND NOT is_deleted;
        IF NOT FOUND THEN
            RAISE EXCEPTION '[P0002]Destination workspace does not exist' USING ERRCODE = 'P0002';
        END IF;
        IF p_node_id = ANY(v_parent.path) OR v_parent.node_type = 'USER'
           OR EXISTS (SELECT 1 FROM users WHERE personal_node_id = p_parent_node_id)
           OR EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = ANY(v_parent.path) AND is_deleted) THEN
            RAISE EXCEPTION '[P0320]Invalid destination workspace' USING ERRCODE = 'P0320';
        END IF;
        IF NOT check_authority_with_override(v_requester, p_parent_node_id, 'NODE_SUB_CREATE') THEN
            RAISE EXCEPTION '[P0103]Destination NODE_SUB_CREATE authority required' USING ERRCODE = 'P0103';
        END IF;
        v_prefix := v_parent.path;
    END IF;

    -- Include soft-deleted descendants so later restoration uses the new path too.
    SELECT array_agg(n.node_id ORDER BY n.node_id), jsonb_agg(jsonb_build_object(
        'node_id', n.node_id, 'name', n.name, 'parent_node_id', n.parent_node_id,
        'path', n.path, 'new_path', v_prefix || n.path[array_length(v_node.path, 1):],
        'is_deleted', n.is_deleted
    ) ORDER BY n.path) INTO v_ids, v_nodes
    FROM organization_nodes n WHERE p_node_id = ANY(n.path);
    v_scope := v_ids || v_node.path || v_prefix;

    -- Only assignments inherited from outside the moving subtree can be lost.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'work_item_id', w.work_item_id, 'owner_node_id', w.owner_node_id,
        'owner_node_name', n.name, 'owner_user_id', w.owner_user_id,
        'title', CASE WHEN w.hidden AND NOT check_authority_with_override(v_requester, n.node_id, 'WI_HIDDEN_VIEW')
                      THEN '숨김 업무' ELSE w.title END,
        'hidden', w.hidden, 'status', w.status
    ) ORDER BY w.work_item_id), '[]') INTO v_work
    FROM work_items w JOIN organization_nodes n ON n.node_id = w.owner_node_id
    WHERE n.node_id = ANY(v_ids) AND NOT n.is_deleted AND NOT w.is_deleted AND w.status <> 'done'
      AND NOT COALESCE(get_authority_source_node(w.owner_user_id, n.node_id) = ANY(v_ids), FALSE)
      AND (NOT check_authority_on_path(w.owner_user_id, v_prefix || n.path[array_length(v_node.path, 1):], 'WI_PERSONAL_CHANGE')
           OR (w.hidden AND NOT check_authority_on_path(w.owner_user_id, v_prefix || n.path[array_length(v_node.path, 1):], 'WI_HIDDEN_CHANGE')));

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'rule_id', r.rule_id, 'title', r.title, 'owner_node_id', r.owner_node_id,
        'assignee_user_id', r.assignee_user_id
    ) ORDER BY r.rule_id), '[]') INTO v_schedules
    FROM recurring_rules r JOIN organization_nodes n ON n.node_id = r.owner_node_id
    WHERE n.node_id = ANY(v_ids) AND NOT n.is_deleted AND NOT r.is_deleted AND r.assignee_user_id IS NOT NULL
      AND NOT COALESCE(get_authority_source_node(r.assignee_user_id, n.node_id) = ANY(v_ids), FALSE)
      AND NOT check_authority_on_path(r.assignee_user_id, v_prefix || n.path[array_length(v_node.path, 1):], 'WI_PERSONAL_CHANGE');

    FOR v_group IN
        SELECT u.user_id, u.name, u.email, jsonb_agg(w.item ORDER BY w.item->>'work_item_id') AS items
        FROM jsonb_array_elements(v_work) AS w(item)
        JOIN users u ON u.user_id = w.item->>'owner_user_id'
        GROUP BY u.user_id, u.name, u.email ORDER BY u.user_id
    LOOP
        SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id', u.user_id, 'name', u.name, 'email', u.email)
            ORDER BY u.name, u.user_id), '[]') INTO v_targets
        FROM users u WHERE NOT u.is_deleted AND u.user_id <> v_group.user_id
          AND EXISTS (SELECT 1 FROM role_assignments r WHERE r.user_id = u.user_id AND r.node_id = ANY(v_ids || v_prefix))
          AND NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(v_group.items) AS w(item)
              JOIN organization_nodes n ON n.node_id = (w.item->>'owner_node_id')::INTEGER
              WHERE NOT check_authority_on_path(u.user_id, v_prefix || n.path[array_length(v_node.path, 1):], 'WI_PERSONAL_CHANGE')
                 OR ((w.item->>'hidden')::BOOLEAN AND NOT check_authority_on_path(u.user_id, v_prefix || n.path[array_length(v_node.path, 1):], 'WI_HIDDEN_CHANGE'))
          );
        v_groups := v_groups || jsonb_build_array(jsonb_build_object(
            'user_id', v_group.user_id, 'name', v_group.name, 'email', v_group.email,
            'work_items', v_group.items, 'transfer_targets', v_targets));
    END LOOP;
    SELECT COALESCE(jsonb_agg(t.item ORDER BY t.item->>'user_id'), '[]') INTO v_all_targets
    FROM jsonb_array_elements(COALESCE(v_groups->0->'transfer_targets', '[]')) AS t(item)
    WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_groups) AS g(item)
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(g.item->'transfer_targets') AS c(item)
            WHERE c.item->>'user_id' = t.item->>'user_id'));

    SELECT COALESCE(jsonb_agg(w.work_item_id ORDER BY w.work_item_id), '[]') INTO v_detached
    FROM work_items w JOIN work_items parent ON parent.work_item_id = w.parent_work_item_id
    WHERE w.owner_node_id = p_node_id AND parent.owner_node_id = v_node.parent_node_id
      AND v_node.parent_node_id IS DISTINCT FROM p_parent_node_id;

    -- Fingerprint the relevant hierarchy, roles and workloads, not just counts.
    -- It detects changes between preview and commit, including newly created work.
    SELECT md5(jsonb_build_object(
        'destination', p_parent_node_id,
        'nodes', (SELECT jsonb_agg(to_jsonb(n) ORDER BY n.node_id) FROM organization_nodes n WHERE n.node_id = ANY(v_scope)),
        'roles', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.assignment_id) FROM role_assignments r WHERE r.node_id = ANY(v_scope)),
        'authorities', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.authority_id) FROM role_authorities a WHERE a.node_id = ANY(v_scope)),
        'users', (SELECT jsonb_agg(jsonb_build_array(u.user_id, u.name, u.email, u.is_deleted) ORDER BY u.user_id) FROM users u
                  WHERE EXISTS (SELECT 1 FROM role_assignments r WHERE r.user_id = u.user_id AND r.node_id = ANY(v_scope))),
        'work', (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.work_item_id) FROM work_items w WHERE w.owner_node_id = ANY(v_ids)),
        'schedules', (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.rule_id) FROM recurring_rules r WHERE r.owner_node_id = ANY(v_ids)),
        'detached', v_detached
    )::TEXT) INTO v_token;

    RETURN jsonb_build_object('type', 'NODE_MOVE_PREVIEW', 'node_id', p_node_id,
        'parent_node_id', p_parent_node_id, 'old_parent_node_id', v_node.parent_node_id,
        'preview_token', v_token, 'nodes', v_nodes, 'owner_groups', v_groups,
        'all_transfer_targets', v_all_targets, 'cleared_schedules', v_schedules,
        'detached_work_item_ids', v_detached,
        'can_move', v_node.parent_node_id IS DISTINCT FROM p_parent_node_id AND
            NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_groups) g WHERE jsonb_array_length(g->'transfer_targets') = 0));
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_node_move_preview(
    p_requester_email VARCHAR, p_node_id INTEGER, p_parent_node_id INTEGER
) RETURNS SETOF integrated_data AS $$
BEGIN
    -- Keep all preview queries on a consistent state even with concurrent writes.
    LOCK TABLE organization_nodes, users, role_assignments, role_authorities, work_items, recurring_rules
        IN SHARE MODE;
    RETURN QUERY SELECT build_node_move_preview(p_requester_email, p_node_id, p_parent_node_id);
END;
$$ LANGUAGE plpgsql;

-- transfers is an object {old_user_id: new_owner_email}; alternatively supply
-- one new_owner_email for every affected owner. Both modes cannot be mixed.
CREATE OR REPLACE FUNCTION move_node(
    p_requester_email VARCHAR, p_node_id INTEGER, p_parent_node_id INTEGER,
    p_preview_token TEXT, p_transfers JSONB DEFAULT '{}', p_new_owner_email VARCHAR DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_preview JSONB;
    v_group JSONB;
    v_work JSONB;
    v_target JSONB;
    v_email TEXT;
    v_item RECORD;
    v_name TEXT;
    v_count INTEGER := 0;
BEGIN
    -- A move changes inherited permissions for an entire subtree. Serialize the
    -- short commit against ordinary writers too (not only other move requests).
    LOCK TABLE organization_nodes, users, role_assignments, role_authorities, work_items, recurring_rules
        IN SHARE ROW EXCLUSIVE MODE;
    v_preview := build_node_move_preview(p_requester_email, p_node_id, p_parent_node_id);
    IF p_preview_token IS NULL OR p_preview_token <> v_preview->>'preview_token' THEN
        RAISE EXCEPTION '[P0321]Workspace changed. Reload the move preview' USING ERRCODE = 'P0321';
    END IF;
    IF NOT (v_preview->>'can_move')::BOOLEAN THEN
        RAISE EXCEPTION '[P0320]Choose a different destination and resolve unavailable transfer targets' USING ERRCODE = 'P0320';
    END IF;
    IF p_transfers IS NULL OR jsonb_typeof(p_transfers) <> 'object'
       OR (NULLIF(TRIM(p_new_owner_email), '') IS NOT NULL AND p_transfers <> '{}'::JSONB) THEN
        RAISE EXCEPTION '[P0322]Choose per-owner transfers or a single transfer target' USING ERRCODE = 'P0322';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(p_transfers) k
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_preview->'owner_groups') g WHERE g->>'user_id' = k)) THEN
        RAISE EXCEPTION '[P0322]Unknown transfer source user' USING ERRCODE = 'P0322';
    END IF;
    -- Validate against post-move authority. Any invalid group rolls back all groups.
    FOR v_group IN SELECT value FROM jsonb_array_elements(v_preview->'owner_groups') LOOP
        v_email := COALESCE(NULLIF(TRIM(p_new_owner_email), ''), p_transfers->>(v_group->>'user_id'));
        SELECT value INTO v_target FROM jsonb_array_elements(v_group->'transfer_targets')
        WHERE value->>'email' = v_email;
        IF v_target IS NULL THEN
            RAISE EXCEPTION '[P0322]Eligible transfer target required for user %', v_group->>'name' USING ERRCODE = 'P0322';
        END IF;
        FOR v_work IN SELECT value FROM jsonb_array_elements(v_group->'work_items') LOOP
            UPDATE work_items SET owner_user_id = v_target->>'user_id' WHERE work_item_id = v_work->>'work_item_id';
            SELECT title INTO v_name FROM work_items WHERE work_item_id = v_work->>'work_item_id';
            PERFORM log_activity((v_work->>'owner_node_id')::INTEGER, p_requester_email, 'WORK_ITEM',
                (v_work->>'work_item_id')::VARCHAR, v_name::VARCHAR, 'updated', 'owner', v_group->>'name', v_target->>'name');
            v_count := v_count + 1;
        END LOOP;
    END LOOP;
    -- Same policy as remove_role: schedules are unassigned, not transferred.
    UPDATE recurring_rules SET assignee_user_id = NULL
    WHERE rule_id IN (SELECT (value->>'rule_id')::INTEGER FROM jsonb_array_elements(v_preview->'cleared_schedules'));
    UPDATE work_items SET parent_work_item_id = NULL, weight = 0
    WHERE work_item_id IN (SELECT jsonb_array_elements_text(v_preview->'detached_work_item_ids'));

    FOR v_item IN SELECT value AS item FROM jsonb_array_elements(v_preview->'nodes') LOOP
        UPDATE organization_nodes SET
            parent_node_id = CASE WHEN node_id = p_node_id THEN p_parent_node_id ELSE parent_node_id END,
            path = ARRAY(SELECT jsonb_array_elements_text(v_item.item->'new_path')::INTEGER)
        WHERE node_id = (v_item.item->>'node_id')::INTEGER;
    END LOOP;
    SELECT name INTO v_name FROM organization_nodes WHERE node_id = p_node_id;
    PERFORM log_activity(p_node_id, p_requester_email, 'NODE', p_node_id::VARCHAR, v_name::VARCHAR,
        'updated', 'workspace_location',
        COALESCE((SELECT name::TEXT FROM organization_nodes WHERE node_id = (v_preview->>'old_parent_node_id')::INTEGER), '루트'),
        COALESCE((SELECT name::TEXT FROM organization_nodes WHERE node_id = p_parent_node_id), '루트'));
    RETURN QUERY SELECT jsonb_build_object('type', 'NODE_MOVE_RESULT', 'node_id', p_node_id,
        'parent_node_id', p_parent_node_id, 'transferred_work_item_count', v_count,
        'cleared_schedule_count', jsonb_array_length(v_preview->'cleared_schedules'),
        'detached_work_item_count', jsonb_array_length(v_preview->'detached_work_item_ids'));
END;
$$ LANGUAGE plpgsql;
