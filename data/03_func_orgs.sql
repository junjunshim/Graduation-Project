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
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_user_id, v_new_node_id, 'ADMIN');

    -- 4. 노드에 대한 기본 권한 설정
    PERFORM default_node_authority(v_new_node_id);

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
        'role', ra.role,
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
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
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (v_owner_user_id, v_new_node_id, 'ADMIN');

    -- 6. 노드에 대한 기본 권한 설정
    PERFORM default_node_authority(v_new_node_id);

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
        'role', ra.role,
        'updated_at', ra.updated_at
    )
    FROM role_assignments ra
    JOIN users u ON ra.user_id = u.user_id
    WHERE ra.node_id = v_new_node_id

    UNION ALL

    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
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
    v_requester_role role_assignments.role%TYPE;
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

    -- 4-2. 노드 멤버 역할 목록 (ROLE) 및 사용자 정보 (USER) - NODE_MEMBERS_VIEW 권한 보유 시 반환
    IF (v_authority & v_node_members_view) = v_node_members_view THEN
        RETURN QUERY
        SELECT jsonb_build_object(
            'type', 'ROLE',
            'id', ra.assignment_id,
            'node_id', ra.node_id,
            'user_id', ra.user_id,
            'user_name', u.name,
            'email', u.email,
            'role', ra.role,
            'updated_at', ra.updated_at
        )
        FROM role_assignments ra
        JOIN users u ON ra.user_id = u.user_id
        WHERE ra.node_id = p_node_id;

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
        WHERE ra.node_id = p_node_id AND u.is_deleted = FALSE;
    END IF;

    -- 4-3. 노드 역할별 권한 정의 목록 (AUTHORITY)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'AUTHORITY',
        'id', a.authority_id,
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
    IF (v_authority & v_file_view) = v_file_view THEN
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