-- =========================================================================
-- 채널 및 1:1 DM 채팅 시스템 저장 프로시저 (TASK_24)
-- =========================================================================

-- 내부 헬퍼 1: 단일 채팅 메시지 객체를 JSONB로 직렬화
CREATE OR REPLACE FUNCTION build_chat_message_json(
    p_message_id INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_res JSONB;
BEGIN
    SELECT jsonb_build_object(
        'type', 'CHAT_MESSAGE',
        'message_id', m.message_id,
        'channel_id', m.channel_id,
        'parent_message_id', m.parent_message_id,
        'sender_user_id', m.sender_user_id,
        'sender_email', u.email,
        'sender_name', u.name,
        'content', CASE WHEN m.is_deleted THEN '삭제된 메시지입니다.' ELSE m.content END,
        'is_edited', m.is_edited,
        'is_deleted', m.is_deleted,
        'reply_count', COALESCE((
            SELECT COUNT(*)::INT
            FROM chat_messages r
            WHERE r.parent_message_id = m.message_id
              AND r.is_deleted = FALSE
        ), 0),
        'last_reply_at', (
            SELECT MAX(r.created_at)
            FROM chat_messages r
            WHERE r.parent_message_id = m.message_id
              AND r.is_deleted = FALSE
        ),
        'reply_senders', COALESCE((
            SELECT jsonb_agg(
                jsonb_build_object('email', s.email, 'name', s.name)
                ORDER BY s.name, s.email
            )
            FROM (
                SELECT DISTINCT u.email, u.name
                FROM chat_messages r
                JOIN users u ON u.user_id = r.sender_user_id
                WHERE r.parent_message_id = m.message_id
                  AND r.is_deleted = FALSE
            ) s
        ), '[]'::jsonb),
        'files', CASE WHEN m.is_deleted THEN '[]'::jsonb ELSE COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'file_id', f.file_id,
                'message_id', f.message_id,
                'original_file_name', f.original_file_name,
                'file_size', f.file_size,
                'mime_type', f.mime_type,
                'created_at', f.created_at
            ) ORDER BY f.file_id ASC)
            FROM chat_message_files f
            WHERE f.message_id = m.message_id
              AND f.is_deleted = FALSE
        ), '[]'::jsonb) END,
        'created_at', m.created_at,
        'updated_at', m.updated_at
    ) INTO v_res
    FROM chat_messages m
    JOIN users u ON m.sender_user_id = u.user_id
    WHERE m.message_id = p_message_id;

    RETURN v_res;
END;
$$ LANGUAGE plpgsql STABLE;


-- 내부 헬퍼 4: 사용자가 특정 채널에서 요구 권한을 가지는지 확인
-- WORKSPACE 채널은 노드 권한(CHANNEL_VIEW/CHANNEL_CHAT/CHANNEL_MANAGE)을 상속해 검사하고,
-- DM 채널은 참여자 여부만 검사한다.
CREATE OR REPLACE FUNCTION check_chat_channel_authority(
    p_user_id users.user_id%TYPE,
    p_channel_id INTEGER,
    p_authority_key VARCHAR
) RETURNS BOOLEAN AS $$
DECLARE
    v_channel chat_channels%ROWTYPE;
BEGIN
    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        RETURN check_authority_with_override(p_user_id, v_channel.owner_node_id, p_authority_key);
    ELSIF v_channel.channel_type = 'DM' THEN
        RETURN p_user_id IN (v_channel.dm_user1_id, v_channel.dm_user2_id);
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;


-- 내부 헬퍼 2: 특정 채널에 대해 실시간 이벤트를 수신할 자격이 있는 사용자 이메일 목록 반환
CREATE OR REPLACE FUNCTION get_channel_recipient_emails(
    p_channel_id INTEGER
) RETURNS TABLE(email VARCHAR) AS $$
DECLARE
    v_channel_type VARCHAR(20);
    v_node_id INTEGER;
    v_u1 VARCHAR(50);
    v_u2 VARCHAR(50);
    v_path INTEGER[];
BEGIN
    SELECT c.channel_type, c.owner_node_id, c.dm_user1_id, c.dm_user2_id
    INTO v_channel_type, v_node_id, v_u1, v_u2
    FROM chat_channels c
    WHERE c.channel_id = p_channel_id;

    IF v_channel_type = 'WORKSPACE' THEN
        SELECT n.path INTO v_path
        FROM organization_nodes n
        WHERE n.node_id = v_node_id;

        RETURN QUERY
        SELECT DISTINCT u.email
        FROM role_assignments ra
        JOIN users u ON u.user_id = ra.user_id
        WHERE ra.node_id = ANY(v_path)
          AND u.is_deleted = FALSE
          AND check_authority_with_override(u.user_id, v_node_id, 'CHANNEL_VIEW') = TRUE;
    ELSIF v_channel_type = 'DM' THEN
        RETURN QUERY
        SELECT u.email
        FROM users u
        WHERE u.user_id IN (v_u1, v_u2)
          AND u.is_deleted = FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE;


-- 내부 헬퍼 3: 노드 권한 변경(역할 정의·배정, 노드 이동) 시 채널 사이드바를 다시 조회해야 하는 사용자 목록
-- 해당 노드, 그 하위 노드, 그 상위 노드에 역할이 배정된 사용자를 대상으로 한다.
CREATE OR REPLACE FUNCTION get_channel_refresh_targets(
    p_node_id organization_nodes.node_id%TYPE
) RETURNS TABLE(email VARCHAR) AS $$
DECLARE
    v_path organization_nodes.path%TYPE;
BEGIN
    SELECT path INTO v_path FROM organization_nodes WHERE node_id = p_node_id;

    RETURN QUERY
    SELECT DISTINCT u.email
    FROM organization_nodes n
    JOIN role_assignments ra ON ra.node_id = n.node_id
    JOIN users u ON u.user_id = ra.user_id
    WHERE u.is_deleted = FALSE
      AND (
          n.node_id = p_node_id
          OR p_node_id = ANY(n.path)
          OR n.node_id = ANY(v_path)
      )
    ORDER BY u.email;
END;
$$ LANGUAGE plpgsql STABLE;


-- 1. ChannelController::getSidebar (GET /api/channels/sidebar)
CREATE OR REPLACE FUNCTION get_user_chat_sidebar(
    p_requester_email VARCHAR
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node RECORD;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 요청자가 CHANNEL_VIEW 권한을 가진 공유 워크스페이스 노드 중 기본 채널이 없는 레거시 노드에 '#일반' 채널 보장
    FOR v_node IN
        SELECT DISTINCT n.node_id
        FROM organization_nodes n
        WHERE n.is_deleted = FALSE
          AND n.node_type NOT IN ('PERSONAL', 'USER')
          AND EXISTS (
              SELECT 1 FROM role_assignments ra
              WHERE ra.user_id = v_user_id
                AND ra.node_id = ANY(n.path)
          )
          AND check_authority_with_override(v_user_id, n.node_id, 'CHANNEL_VIEW') = TRUE
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM chat_channels c
            WHERE c.channel_type = 'WORKSPACE'
              AND c.owner_node_id = v_node.node_id
              AND c.is_default = TRUE
              AND c.is_deleted = FALSE
        ) THEN
            -- 레거시 데이터에 '일반' 채널이 이미 있으면 새로 만들지 않고 기본 채널로 승격한다.
            UPDATE chat_channels
            SET is_default = TRUE
            WHERE channel_type = 'WORKSPACE'
              AND owner_node_id = v_node.node_id
              AND lower(name) = '일반'
              AND is_deleted = FALSE;

            IF NOT FOUND THEN
                INSERT INTO chat_channels (
                    channel_type,
                    owner_node_id,
                    name,
                    description,
                    is_default,
                    created_by_user_id
                ) VALUES (
                    'WORKSPACE',
                    v_node.node_id,
                    '일반',
                    '워크스페이스 기본 소통 채널입니다.',
                    TRUE,
                    v_user_id
                ) ON CONFLICT DO NOTHING;
            END IF;
        END IF;
    END LOOP;

    -- 3-A. 워크스페이스 채널 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORKSPACE_CHANNEL',
        'channel_id', c.channel_id,
        'channel_type', c.channel_type,
        'owner_node_id', c.owner_node_id,
        'owner_node_name', n.name,
        'owner_node_type', n.node_type,
        'name', c.name,
        'description', COALESCE(c.description, ''),
        'is_default', c.is_default,
        'can_chat', check_authority_with_override(v_user_id, n.node_id, 'CHANNEL_CHAT'),
        'can_manage', check_authority_with_override(v_user_id, n.node_id, 'CHANNEL_MANAGE'),
        'unread_count', COALESCE((
            SELECT COUNT(*)::INT
            FROM chat_messages m
            WHERE m.channel_id = c.channel_id
              AND m.parent_message_id IS NULL
              AND m.is_deleted = FALSE
              AND m.sender_user_id <> v_user_id
              AND m.message_id > COALESCE(r.last_read_message_id, 0)
        ), 0),
        'last_message_preview', last_msg.preview,
        'last_message_sender_name', last_msg.sender_name,
        'last_message_at', COALESCE(last_msg.created_at, c.last_message_at, c.created_at),
        'created_at', c.created_at
    )
    FROM organization_nodes n
    JOIN chat_channels c ON c.owner_node_id = n.node_id
        AND c.channel_type = 'WORKSPACE'
        AND c.is_deleted = FALSE
    LEFT JOIN chat_channel_reads r ON r.channel_id = c.channel_id AND r.user_id = v_user_id
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN trim(m.content) <> '' THEN m.content
                WHEN EXISTS (
                    SELECT 1 FROM chat_message_files f
                    WHERE f.message_id = m.message_id AND f.is_deleted = FALSE
                ) THEN '[파일 첨부]'
                ELSE ''
            END AS preview,
            u.name AS sender_name,
            m.created_at
        FROM chat_messages m
        JOIN users u ON u.user_id = m.sender_user_id
        WHERE m.channel_id = c.channel_id
          AND m.parent_message_id IS NULL
          AND m.is_deleted = FALSE
        ORDER BY m.message_id DESC
        LIMIT 1
    ) last_msg ON TRUE
    WHERE n.is_deleted = FALSE
      AND n.node_type NOT IN ('PERSONAL', 'USER')
      AND EXISTS (
          SELECT 1 FROM role_assignments ra
          WHERE ra.user_id = v_user_id
            AND ra.node_id = ANY(n.path)
      )
      AND check_authority_with_override(v_user_id, n.node_id, 'CHANNEL_VIEW') = TRUE
    ORDER BY n.path ASC, c.is_default DESC, c.channel_id ASC;

    -- 3-B. 참여 중인 1:1 DM 채널 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'DM_CHANNEL',
        'channel_id', c.channel_id,
        'channel_type', c.channel_type,
        'counterpart_user_id', u_other.user_id,
        'counterpart_email', u_other.email,
        'counterpart_name', u_other.name,
        'can_chat', TRUE,
        'can_manage', FALSE,
        'unread_count', COALESCE((
            SELECT COUNT(*)::INT
            FROM chat_messages m
            WHERE m.channel_id = c.channel_id
              AND m.parent_message_id IS NULL
              AND m.is_deleted = FALSE
              AND m.sender_user_id <> v_user_id
              AND m.message_id > COALESCE(r.last_read_message_id, 0)
        ), 0),
        'last_message_preview', last_msg.preview,
        'last_message_sender_name', last_msg.sender_name,
        'last_message_at', COALESCE(last_msg.created_at, c.last_message_at, c.created_at),
        'created_at', c.created_at
    )
    FROM chat_channels c
    JOIN users u_other ON u_other.user_id = CASE
        WHEN c.dm_user1_id = v_user_id THEN c.dm_user2_id
        ELSE c.dm_user1_id
    END
    LEFT JOIN chat_channel_reads r ON r.channel_id = c.channel_id AND r.user_id = v_user_id
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN trim(m.content) <> '' THEN m.content
                WHEN EXISTS (
                    SELECT 1 FROM chat_message_files f
                    WHERE f.message_id = m.message_id AND f.is_deleted = FALSE
                ) THEN '[파일 첨부]'
                ELSE ''
            END AS preview,
            u.name AS sender_name,
            m.created_at
        FROM chat_messages m
        JOIN users u ON u.user_id = m.sender_user_id
        WHERE m.channel_id = c.channel_id
          AND m.parent_message_id IS NULL
          AND m.is_deleted = FALSE
        ORDER BY m.message_id DESC
        LIMIT 1
    ) last_msg ON TRUE
    WHERE c.channel_type = 'DM'
      AND c.is_deleted = FALSE
      AND (c.dm_user1_id = v_user_id OR c.dm_user2_id = v_user_id)
      AND u_other.is_deleted = FALSE
    ORDER BY COALESCE(last_msg.created_at, c.last_message_at, c.created_at) DESC, c.channel_id DESC;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to fetch chat sidebar: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 2. ChannelController::createChannel (POST /api/channels)
CREATE OR REPLACE FUNCTION create_workspace_channel(
    p_requester_email VARCHAR,
    p_node_id INTEGER,
    p_name VARCHAR,
    p_description TEXT DEFAULT ''
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_node RECORD;
    v_clean_name VARCHAR(100);
    v_channel_id INTEGER;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_node
    FROM organization_nodes
    WHERE node_id = p_node_id AND is_deleted = FALSE AND node_type NOT IN ('PERSONAL', 'USER');

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Workspace node does not exist: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    IF NOT check_authority_with_override(v_user_id, p_node_id, 'CHANNEL_MANAGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_MANAGE required.'
        USING ERRCODE = 'P0103';
    END IF;

    v_clean_name := trim(both ' ' FROM regexp_replace(COALESCE(p_name, ''), '^#+', ''));
    IF v_clean_name = '' THEN
        RAISE EXCEPTION '[P0906]Channel name cannot be empty'
        USING ERRCODE = 'P0906';
    END IF;

    IF EXISTS (
        SELECT 1 FROM chat_channels
        WHERE channel_type = 'WORKSPACE'
          AND owner_node_id = p_node_id
          AND lower(name) = lower(v_clean_name)
          AND is_deleted = FALSE
    ) THEN
        RAISE EXCEPTION '[P0902]Channel name already exists in this workspace: %', v_clean_name
        USING ERRCODE = 'P0902';
    END IF;

    INSERT INTO chat_channels (
        channel_type,
        owner_node_id,
        name,
        description,
        is_default,
        created_by_user_id
    ) VALUES (
        'WORKSPACE',
        p_node_id,
        v_clean_name,
        COALESCE(p_description, ''),
        FALSE,
        v_user_id
    ) RETURNING channel_id INTO v_channel_id;

    -- 첫 행: 생성된 WORKSPACE_CHANNEL 객체 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORKSPACE_CHANNEL',
        'channel_id', c.channel_id,
        'channel_type', c.channel_type,
        'owner_node_id', c.owner_node_id,
        'owner_node_name', v_node.name,
        'owner_node_type', v_node.node_type,
        'name', c.name,
        'description', COALESCE(c.description, ''),
        'is_default', c.is_default,
        'can_chat', check_authority_with_override(v_user_id, p_node_id, 'CHANNEL_CHAT'),
        'can_manage', check_authority_with_override(v_user_id, p_node_id, 'CHANNEL_MANAGE'),
        'unread_count', 0,
        'last_message_preview', NULL,
        'last_message_sender_name', NULL,
        'last_message_at', c.last_message_at,
        'created_at', c.created_at
    )
    FROM chat_channels c
    WHERE c.channel_id = v_channel_id;

    -- 후속 행: 웹소켓 알림 행 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'CHANNEL_CREATED',
        'data', jsonb_build_object(
            'channel_id', v_channel_id,
            'node_id', p_node_id,
            'name', v_clean_name,
            'description', COALESCE(p_description, ''),
            'actor_email', p_requester_email
        )
    )
    FROM get_channel_recipient_emails(v_channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' OR SQLSTATE 'P0902' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to create workspace channel: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 3. ChannelController::updateChannel (PATCH /api/channels)
CREATE OR REPLACE FUNCTION update_workspace_channel(
    p_requester_email VARCHAR,
    p_channel_id INTEGER,
    p_name VARCHAR,
    p_description TEXT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel chat_channels%ROWTYPE;
    v_node organization_nodes%ROWTYPE;
    v_clean_name VARCHAR(100);
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND channel_type = 'WORKSPACE' AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    SELECT * INTO v_node
    FROM organization_nodes
    WHERE node_id = v_channel.owner_node_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Owner workspace node not found'
        USING ERRCODE = 'P0901';
    END IF;

    IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_MANAGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_MANAGE required.'
        USING ERRCODE = 'P0103';
    END IF;

    v_clean_name := trim(both ' ' FROM regexp_replace(COALESCE(p_name, ''), '^#+', ''));
    IF v_clean_name = '' THEN
        v_clean_name := v_channel.name;
    END IF;

    IF EXISTS (
        SELECT 1 FROM chat_channels
        WHERE channel_type = 'WORKSPACE'
          AND owner_node_id = v_channel.owner_node_id
          AND lower(name) = lower(v_clean_name)
          AND channel_id <> p_channel_id
          AND is_deleted = FALSE
    ) THEN
        RAISE EXCEPTION '[P0902]Channel name already exists in this workspace: %', v_clean_name
        USING ERRCODE = 'P0902';
    END IF;

    UPDATE chat_channels
    SET name = v_clean_name,
        description = CASE WHEN p_description IS NULL THEN description ELSE p_description END
    WHERE channel_id = p_channel_id;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'WORKSPACE_CHANNEL',
        'channel_id', c.channel_id,
        'channel_type', c.channel_type,
        'owner_node_id', c.owner_node_id,
        'owner_node_name', v_node.name,
        'owner_node_type', v_node.node_type,
        'name', c.name,
        'description', COALESCE(c.description, ''),
        'is_default', c.is_default,
        'can_chat', check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_CHAT'),
        'can_manage', check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_MANAGE'),
        'unread_count', 0,
        'last_message_preview', NULL,
        'last_message_sender_name', NULL,
        'last_message_at', c.last_message_at,
        'created_at', c.created_at
    )
    FROM chat_channels c
    WHERE c.channel_id = p_channel_id;

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'CHANNEL_UPDATED',
        'data', jsonb_build_object(
            'channel_id', p_channel_id,
            'node_id', v_channel.owner_node_id,
            'name', v_clean_name,
            'description', COALESCE(p_description, v_channel.description, ''),
            'actor_email', p_requester_email
        )
    )
    FROM get_channel_recipient_emails(p_channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0902' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to update workspace channel: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 4. ChannelController::deleteChannel (DELETE /api/channels)
CREATE OR REPLACE FUNCTION delete_workspace_channel(
    p_requester_email VARCHAR,
    p_channel_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel chat_channels%ROWTYPE;
    v_recipients VARCHAR[];
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND channel_type = 'WORKSPACE' AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_MANAGE') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_MANAGE required.'
        USING ERRCODE = 'P0103';
    END IF;

    IF v_channel.is_default = TRUE THEN
        RAISE EXCEPTION '[P0903]Cannot delete default channel'
        USING ERRCODE = 'P0903';
    END IF;

    SELECT COALESCE(array_agg(r.email), '{}'::VARCHAR[])
    INTO v_recipients
    FROM get_channel_recipient_emails(p_channel_id) r;

    UPDATE chat_message_files
    SET is_deleted = TRUE
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    UPDATE chat_messages
    SET is_deleted = TRUE
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    UPDATE chat_channels
    SET is_deleted = TRUE
    WHERE channel_id = p_channel_id;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'CHANNEL_DELETED',
        'channel_id', p_channel_id,
        'owner_node_id', v_channel.owner_node_id,
        'status', 'deleted'
    );

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', em,
        'type', 'CHAT',
        'sub_type', 'CHANNEL_DELETED',
        'data', jsonb_build_object(
            'channel_id', p_channel_id,
            'node_id', v_channel.owner_node_id,
            'actor_email', p_requester_email
        )
    )
    FROM unnest(v_recipients) AS em;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0903' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to delete workspace channel: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 5. ChannelController::openOrCreateDm (POST /api/channels/dm)
CREATE OR REPLACE FUNCTION open_or_create_dm_channel(
    p_requester_email VARCHAR,
    p_target_email VARCHAR
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_req_user users%ROWTYPE;
    v_target_user users%ROWTYPE;
    v_clean_target_email VARCHAR;
    v_u1 VARCHAR(50);
    v_u2 VARCHAR(50);
    v_channel_id INTEGER;
    v_is_new BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_req_user
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    v_clean_target_email := lower(trim(COALESCE(p_target_email, '')));

    IF v_clean_target_email = lower(v_req_user.email) THEN
        RAISE EXCEPTION '[P0904]Cannot start DM with yourself'
        USING ERRCODE = 'P0904';
    END IF;

    SELECT * INTO v_target_user
    FROM users
    WHERE lower(email) = v_clean_target_email AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Target user does not exist: %', p_target_email
        USING ERRCODE = 'P0002';
    END IF;

    v_u1 := LEAST(v_req_user.user_id, v_target_user.user_id);
    v_u2 := GREATEST(v_req_user.user_id, v_target_user.user_id);

    -- 같은 두 사용자가 동시에 DM 을 열어도 채널이 중복 생성되지 않도록 사용자 쌍 단위로 직렬화한다.
    PERFORM pg_advisory_xact_lock(hashtext(v_u1 || ':' || v_u2));

    SELECT channel_id INTO v_channel_id
    FROM chat_channels
    WHERE channel_type = 'DM'
      AND dm_user1_id = v_u1
      AND dm_user2_id = v_u2
      AND is_deleted = FALSE;

    IF v_channel_id IS NULL THEN
        INSERT INTO chat_channels (
            channel_type,
            dm_user1_id,
            dm_user2_id,
            created_by_user_id
        ) VALUES (
            'DM',
            v_u1,
            v_u2,
            v_req_user.user_id
        ) RETURNING channel_id INTO v_channel_id;
        v_is_new := TRUE;
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'DM_CHANNEL',
        'channel_id', c.channel_id,
        'channel_type', c.channel_type,
        'counterpart_user_id', v_target_user.user_id,
        'counterpart_email', v_target_user.email,
        'counterpart_name', v_target_user.name,
        'can_chat', TRUE,
        'can_manage', FALSE,
        'unread_count', COALESCE((
            SELECT COUNT(*)::INT
            FROM chat_messages m
            WHERE m.channel_id = c.channel_id
              AND m.parent_message_id IS NULL
              AND m.is_deleted = FALSE
              AND m.sender_user_id <> v_req_user.user_id
              AND m.message_id > COALESCE(r.last_read_message_id, 0)
        ), 0),
        'last_message_preview', last_msg.preview,
        'last_message_sender_name', last_msg.sender_name,
        'last_message_at', COALESCE(last_msg.created_at, c.last_message_at, c.created_at),
        'created_at', c.created_at
    )
    FROM chat_channels c
    LEFT JOIN chat_channel_reads r ON r.channel_id = c.channel_id AND r.user_id = v_req_user.user_id
    LEFT JOIN LATERAL (
        SELECT
            CASE
                WHEN trim(m.content) <> '' THEN m.content
                WHEN EXISTS (
                    SELECT 1 FROM chat_message_files f
                    WHERE f.message_id = m.message_id AND f.is_deleted = FALSE
                ) THEN '[파일 첨부]'
                ELSE ''
            END AS preview,
            u.name AS sender_name,
            m.created_at
        FROM chat_messages m
        JOIN users u ON u.user_id = m.sender_user_id
        WHERE m.channel_id = c.channel_id
          AND m.parent_message_id IS NULL
          AND m.is_deleted = FALSE
        ORDER BY m.message_id DESC
        LIMIT 1
    ) last_msg ON TRUE
    WHERE c.channel_id = v_channel_id;

    IF v_is_new THEN
        RETURN QUERY
        SELECT jsonb_build_object(
            'target_email', v_target_user.email,
            'type', 'CHAT',
            'sub_type', 'CHANNEL_CREATED',
            'data', jsonb_build_object(
                'channel_id', v_channel_id,
                'channel_type', 'DM',
                'actor_email', p_requester_email
            )
        );
    END IF;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0904' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to open or create DM channel: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 6. ChannelController::getMessages (GET /api/channels/messages)
CREATE OR REPLACE FUNCTION get_channel_messages(
    p_requester_email VARCHAR,
    p_channel_id INTEGER,
    p_before_message_id INTEGER DEFAULT NULL,
    p_limit INTEGER DEFAULT 100
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel chat_channels%ROWTYPE;
    v_max_msg_id INTEGER;
    v_eff_limit INTEGER;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view channel'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'DM' THEN
        IF v_user_id NOT IN (v_channel.dm_user1_id, v_channel.dm_user2_id) THEN
            RAISE EXCEPTION '[P0103]Not a participant of this DM channel'
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 최신 메시지 ID로 읽음 상태 UPSERT
    SELECT COALESCE(MAX(message_id), 0) INTO v_max_msg_id
    FROM chat_messages
    WHERE channel_id = p_channel_id;

    INSERT INTO chat_channel_reads (channel_id, user_id, last_read_message_id, last_read_at)
    VALUES (p_channel_id, v_user_id, v_max_msg_id, CURRENT_TIMESTAMP)
    ON CONFLICT (channel_id, user_id) DO UPDATE
    SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
        last_read_at = CURRENT_TIMESTAMP;

    v_eff_limit := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);

    RETURN QUERY
    SELECT build_chat_message_json(sub.message_id)
    FROM (
        SELECT m.message_id
        FROM chat_messages m
        WHERE m.channel_id = p_channel_id
          AND m.parent_message_id IS NULL
          AND (p_before_message_id IS NULL OR p_before_message_id <= 0 OR m.message_id < p_before_message_id)
          AND (
              m.is_deleted = FALSE
              OR EXISTS (
                  SELECT 1 FROM chat_messages r
                  WHERE r.parent_message_id = m.message_id
                    AND r.is_deleted = FALSE
              )
          )
        ORDER BY m.message_id DESC
        LIMIT v_eff_limit
    ) sub
    ORDER BY sub.message_id ASC;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to fetch channel messages: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 7. ChannelController::getThreadMessages (GET /api/channels/threads)
CREATE OR REPLACE FUNCTION get_thread_messages(
    p_requester_email VARCHAR,
    p_parent_message_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_parent chat_messages%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_parent
    FROM chat_messages
    WHERE message_id = p_parent_message_id AND parent_message_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Parent message not found: %', p_parent_message_id
        USING ERRCODE = 'P0905';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_parent.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_parent.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to view thread'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'DM' THEN
        IF v_user_id NOT IN (v_channel.dm_user1_id, v_channel.dm_user2_id) THEN
            RAISE EXCEPTION '[P0103]Not a participant of this DM channel'
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    -- 1행: 부모 메시지
    RETURN QUERY
    SELECT build_chat_message_json(p_parent_message_id);

    -- 후속 행: 답글 목록
    RETURN QUERY
    SELECT build_chat_message_json(r.message_id)
    FROM chat_messages r
    WHERE r.parent_message_id = p_parent_message_id
      AND r.is_deleted = FALSE
    ORDER BY r.message_id ASC;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to fetch thread messages: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 8. ChannelController::createMessage (POST /api/channels/messages)
CREATE OR REPLACE FUNCTION create_chat_message(
    p_requester_email VARCHAR,
    p_channel_id INTEGER,
    p_parent_message_id INTEGER DEFAULT NULL,
    p_content TEXT DEFAULT ''
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel chat_channels%ROWTYPE;
    v_parent_id INTEGER;
    v_msg_id INTEGER;
    v_msg_json JSONB;
    v_ws_data JSONB;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_CHAT') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_CHAT required.'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'DM' THEN
        IF v_user_id NOT IN (v_channel.dm_user1_id, v_channel.dm_user2_id) THEN
            RAISE EXCEPTION '[P0103]Not a participant of this DM channel'
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    IF p_parent_message_id IS NOT NULL AND p_parent_message_id > 0 THEN
        v_parent_id := p_parent_message_id;
        IF NOT EXISTS (
            SELECT 1 FROM chat_messages
            WHERE message_id = v_parent_id
              AND channel_id = p_channel_id
              AND parent_message_id IS NULL
        ) THEN
            RAISE EXCEPTION '[P0905]Parent message not found in this channel: %', v_parent_id
            USING ERRCODE = 'P0905';
        END IF;
    ELSE
        v_parent_id := NULL;
    END IF;

    INSERT INTO chat_messages (
        channel_id,
        parent_message_id,
        sender_user_id,
        content
    ) VALUES (
        p_channel_id,
        v_parent_id,
        v_user_id,
        COALESCE(p_content, '')
    ) RETURNING message_id INTO v_msg_id;

    UPDATE chat_channels
    SET last_message_at = CURRENT_TIMESTAMP
    WHERE channel_id = p_channel_id;

    INSERT INTO chat_channel_reads (channel_id, user_id, last_read_message_id, last_read_at)
    VALUES (p_channel_id, v_user_id, v_msg_id, CURRENT_TIMESTAMP)
    ON CONFLICT (channel_id, user_id) DO UPDATE
    SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
        last_read_at = CURRENT_TIMESTAMP;

    v_msg_json := build_chat_message_json(v_msg_id);

    -- 첫 행: 생성된 CHAT_MESSAGE 반환
    RETURN QUERY SELECT v_msg_json;

    -- 후속 행: 채널 수신자 웹소켓 이벤트 반환
    v_ws_data := v_msg_json || jsonb_build_object(
        'channel_type', v_channel.channel_type,
        'owner_node_id', v_channel.owner_node_id
    );

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'MESSAGE_CREATED',
        'data', v_ws_data
    )
    FROM get_channel_recipient_emails(p_channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to create chat message: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 9. ChannelController::updateMessage (PATCH /api/channels/messages)
CREATE OR REPLACE FUNCTION update_chat_message(
    p_requester_email VARCHAR,
    p_message_id INTEGER,
    p_content TEXT
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_msg chat_messages%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
    v_msg_json JSONB;
    v_ws_data JSONB;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_msg
    FROM chat_messages
    WHERE message_id = p_message_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Chat message not found: %', p_message_id
        USING ERRCODE = 'P0905';
    END IF;

    IF v_msg.sender_user_id <> v_user_id THEN
        RAISE EXCEPTION '[P0103]Only the author can edit this message'
        USING ERRCODE = 'P0103';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_msg.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_msg.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    -- 채널 접근 권한이 회수된 뒤에도 예전에 작성한 메시지를 수정할 수 없도록 매 요청마다 재검사한다.
    IF NOT check_chat_channel_authority(v_user_id, v_msg.channel_id, 'CHANNEL_CHAT') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_CHAT required.'
        USING ERRCODE = 'P0103';
    END IF;

    UPDATE chat_messages
    SET content = COALESCE(p_content, ''),
        is_edited = TRUE
    WHERE message_id = p_message_id;

    v_msg_json := build_chat_message_json(p_message_id);

    RETURN QUERY SELECT v_msg_json;

    v_ws_data := v_msg_json || jsonb_build_object(
        'channel_type', v_channel.channel_type,
        'owner_node_id', v_channel.owner_node_id
    );

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'MESSAGE_UPDATED',
        'data', v_ws_data
    )
    FROM get_channel_recipient_emails(v_msg.channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to update chat message: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 10. ChannelController::deleteMessage (DELETE /api/channels/messages)
CREATE OR REPLACE FUNCTION delete_chat_message(
    p_requester_email VARCHAR,
    p_message_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_msg chat_messages%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
    v_msg_json JSONB;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_msg
    FROM chat_messages
    WHERE message_id = p_message_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Chat message not found: %', p_message_id
        USING ERRCODE = 'P0905';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_msg.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_msg.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    -- 작성자라도 채널 접근 권한이 없으면 삭제할 수 없다. 타인 메시지는 채널 관리자만 삭제한다.
    IF v_msg.sender_user_id = v_user_id THEN
        IF NOT check_chat_channel_authority(v_user_id, v_msg.channel_id, 'CHANNEL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete this message'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_chat_channel_authority(v_user_id, v_msg.channel_id, 'CHANNEL_MANAGE') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to delete this message'
            USING ERRCODE = 'P0103';
        END IF;
    ELSE
        RAISE EXCEPTION '[P0103]Only the author can delete this DM message'
        USING ERRCODE = 'P0103';
    END IF;

    UPDATE chat_message_files
    SET is_deleted = TRUE
    WHERE message_id = p_message_id AND is_deleted = FALSE;

    UPDATE chat_messages
    SET is_deleted = TRUE
    WHERE message_id = p_message_id;

    v_msg_json := build_chat_message_json(p_message_id);

    RETURN QUERY SELECT v_msg_json;

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'MESSAGE_DELETED',
        'data', v_msg_json || jsonb_build_object(
            'channel_type', v_channel.channel_type,
            'owner_node_id', v_channel.owner_node_id
        )
    )
    FROM get_channel_recipient_emails(v_msg.channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to delete chat message: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 10-2. ChannelController::uploadFile 사전 검증 (POST /api/channels/files/upload)
-- 파일을 디스크에 저장하기 **전에** 메시지 작성자·채널 권한을 확인하고 실제 저장 경로에 쓸
-- channel_id/message_id를 돌려준다. 클라이언트가 보낸 channel_id로 경로를 만들지 않기 위한 함수다.
CREATE OR REPLACE FUNCTION get_chat_message_upload_target(
    p_requester_email VARCHAR,
    p_message_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_msg chat_messages%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_msg
    FROM chat_messages
    WHERE message_id = p_message_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Chat message not found: %', p_message_id
        USING ERRCODE = 'P0905';
    END IF;

    IF v_msg.sender_user_id <> v_user_id THEN
        RAISE EXCEPTION '[P0103]Only the message author can attach files to this message'
        USING ERRCODE = 'P0103';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_msg.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_msg.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF NOT check_chat_channel_authority(v_user_id, v_msg.channel_id, 'CHANNEL_CHAT') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_CHAT required.'
        USING ERRCODE = 'P0103';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'CHAT_FILE_UPLOAD_TARGET',
        'message_id', v_msg.message_id,
        'channel_id', v_channel.channel_id,
        'channel_type', v_channel.channel_type,
        'owner_node_id', v_channel.owner_node_id
    );

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to resolve chat file upload target: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 11. ChannelController::uploadFile (POST /api/channels/files/upload)
CREATE OR REPLACE FUNCTION add_chat_message_file(
    p_requester_email VARCHAR,
    p_message_id INTEGER,
    p_original_name VARCHAR,
    p_stored_name VARCHAR,
    p_file_path TEXT,
    p_file_size BIGINT,
    p_mime_type VARCHAR
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_msg chat_messages%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
    v_msg_json JSONB;
    v_ws_data JSONB;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_msg
    FROM chat_messages
    WHERE message_id = p_message_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Chat message not found: %', p_message_id
        USING ERRCODE = 'P0905';
    END IF;

    IF v_msg.sender_user_id <> v_user_id THEN
        RAISE EXCEPTION '[P0103]Only the message author can attach files to this message'
        USING ERRCODE = 'P0103';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_msg.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_msg.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF NOT check_chat_channel_authority(v_user_id, v_msg.channel_id, 'CHANNEL_CHAT') THEN
        RAISE EXCEPTION '[P0103]Insufficient permissions. CHANNEL_CHAT required.'
        USING ERRCODE = 'P0103';
    END IF;

    INSERT INTO chat_message_files (
        message_id,
        channel_id,
        uploader_user_id,
        original_file_name,
        stored_file_name,
        file_path,
        file_size,
        mime_type
    ) VALUES (
        p_message_id,
        v_msg.channel_id,
        v_user_id,
        p_original_name,
        p_stored_name,
        p_file_path,
        p_file_size,
        p_mime_type
    );

    UPDATE chat_channels
    SET last_message_at = CURRENT_TIMESTAMP
    WHERE channel_id = v_msg.channel_id;

    v_msg_json := build_chat_message_json(p_message_id);

    RETURN QUERY SELECT v_msg_json;

    v_ws_data := v_msg_json || jsonb_build_object(
        'channel_type', v_channel.channel_type,
        'owner_node_id', v_channel.owner_node_id
    );

    RETURN QUERY
    SELECT jsonb_build_object(
        'target_email', r.email,
        'type', 'CHAT',
        'sub_type', 'MESSAGE_FILE_ADDED',
        'data', v_ws_data
    )
    FROM get_channel_recipient_emails(v_msg.channel_id) r;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to attach file to chat message: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 12. ChannelController::downloadFile (GET /api/channels/files/download)
CREATE OR REPLACE FUNCTION get_chat_file_for_download(
    p_requester_email VARCHAR,
    p_file_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_file chat_message_files%ROWTYPE;
    v_channel chat_channels%ROWTYPE;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_file
    FROM chat_message_files
    WHERE file_id = p_file_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0905]Chat attachment file not found: %', p_file_id
        USING ERRCODE = 'P0905';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = v_file.channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', v_file.channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to download file'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'DM' THEN
        IF v_user_id NOT IN (v_channel.dm_user1_id, v_channel.dm_user2_id) THEN
            RAISE EXCEPTION '[P0103]Not a participant of this DM channel'
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'CHAT_FILE_DOWNLOAD',
        'file_id', v_file.file_id,
        'message_id', v_file.message_id,
        'channel_id', v_file.channel_id,
        'original_file_name', v_file.original_file_name,
        'stored_file_name', v_file.stored_file_name,
        'file_path', v_file.file_path,
        'file_size', v_file.file_size,
        'mime_type', COALESCE(v_file.mime_type, 'application/octet-stream'),
        'updated_at', v_file.updated_at
    );

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0905' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to fetch chat file for download: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 13. ChannelController::markAsRead (POST /api/channels/read)
CREATE OR REPLACE FUNCTION mark_channel_as_read(
    p_requester_email VARCHAR,
    p_channel_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel chat_channels%ROWTYPE;
    v_max_msg_id INTEGER;
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0901]Channel not found: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        IF NOT check_authority_with_override(v_user_id, v_channel.owner_node_id, 'CHANNEL_VIEW') THEN
            RAISE EXCEPTION '[P0103]Insufficient permissions to access channel'
            USING ERRCODE = 'P0103';
        END IF;
    ELSIF v_channel.channel_type = 'DM' THEN
        IF v_user_id NOT IN (v_channel.dm_user1_id, v_channel.dm_user2_id) THEN
            RAISE EXCEPTION '[P0103]Not a participant of this DM channel'
            USING ERRCODE = 'P0103';
        END IF;
    END IF;

    SELECT COALESCE(MAX(message_id), 0) INTO v_max_msg_id
    FROM chat_messages
    WHERE channel_id = p_channel_id;

    INSERT INTO chat_channel_reads (channel_id, user_id, last_read_message_id, last_read_at)
    VALUES (p_channel_id, v_user_id, v_max_msg_id, CURRENT_TIMESTAMP)
    ON CONFLICT (channel_id, user_id) DO UPDATE
    SET last_read_message_id = GREATEST(chat_channel_reads.last_read_message_id, EXCLUDED.last_read_message_id),
        last_read_at = CURRENT_TIMESTAMP;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'CHANNEL_READ',
        'channel_id', p_channel_id,
        'last_read_message_id', v_max_msg_id
    );

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0901' OR SQLSTATE 'P0906' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to mark channel as read: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql;


-- 14. NotificationWebSocketController::CHANNEL_JOIN / CHANNEL_PRESENCE 지원
-- (1) 내부 헬퍼: 채널을 볼 수 있는 사용자 목록(이메일, 이름)을 반환한다.
--     WORKSPACE 는 채널 소유 노드에서 CHANNEL_VIEW 를 통과하는 사용자 전체,
--     DM 은 삭제되지 않은 두 참여자다.
CREATE OR REPLACE FUNCTION get_chat_channel_audience(
    p_channel_id INTEGER
) RETURNS JSONB AS $$
DECLARE
    v_channel chat_channels%ROWTYPE;
    v_path INTEGER[];
BEGIN
    SELECT * INTO v_channel
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RETURN '[]'::jsonb;
    END IF;

    IF v_channel.channel_type = 'WORKSPACE' THEN
        SELECT n.path INTO v_path
        FROM organization_nodes n
        WHERE n.node_id = v_channel.owner_node_id;

        RETURN (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object('email', audience.email, 'name', audience.name)
                    ORDER BY audience.name, audience.email
                ), '[]'::jsonb
            )
            FROM (
                SELECT DISTINCT
                    u.email,
                    COALESCE(NULLIF(TRIM(u.name), ''), u.email) AS name
                FROM role_assignments ra
                JOIN users u ON u.user_id = ra.user_id
                WHERE ra.node_id = ANY(v_path)
                  AND u.is_deleted = FALSE
                  AND check_authority_with_override(u.user_id, v_channel.owner_node_id, 'CHANNEL_VIEW') = TRUE
            ) AS audience
        );
    ELSIF v_channel.channel_type = 'DM' THEN
        RETURN (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'email', u.email,
                        'name', COALESCE(NULLIF(TRIM(u.name), ''), u.email)
                    )
                    ORDER BY u.email
                ), '[]'::jsonb
            )
            FROM users u
            WHERE u.user_id IN (v_channel.dm_user1_id, v_channel.dm_user2_id)
              AND u.is_deleted = FALSE
        );
    END IF;

    RETURN '[]'::jsonb;
END;
$$ LANGUAGE plpgsql STABLE;


-- (2) 채널 참여 자격(CHANNEL_VIEW)을 확인하고, 채널을 볼 수 있는 사용자 전체를 반환한다.
CREATE OR REPLACE FUNCTION get_chat_channel_participants(
    p_requester_email VARCHAR,
    p_channel_id INTEGER
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_user_id users.user_id%TYPE;
    v_channel_type VARCHAR(20);
BEGIN
    SELECT user_id INTO v_user_id
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 채널이 없거나 볼 권한이 없으면 같은 오류로 응답해 채널 존재 여부를 노출하지 않는다.
    IF NOT check_chat_channel_authority(v_user_id, p_channel_id, 'CHANNEL_VIEW') THEN
        RAISE EXCEPTION '[P0901]Channel not found or no permission: %', p_channel_id
        USING ERRCODE = 'P0901';
    END IF;

    SELECT channel_type INTO v_channel_type
    FROM chat_channels
    WHERE channel_id = p_channel_id AND is_deleted = FALSE;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'CHAT_PARTICIPANTS',
        'channel_id', p_channel_id,
        'channel_type', v_channel_type,
        'participants', get_chat_channel_audience(p_channel_id)
    );

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0901' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0906]Failed to get chat channel participants: %', SQLERRM
            USING ERRCODE = 'P0906';
END;
$$ LANGUAGE plpgsql STABLE;
