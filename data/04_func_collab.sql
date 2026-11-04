-- 협업(collab) 사이드카 권한 통보 지원 함수 (TASK_11 §12.9).
--
-- 역할 정의나 역할 배정이 바뀌면, 그 노드에 연결된 저장소에서 작업 중인 사용자의 권한이 달라질
-- 수 있다 — 쓰기(GITHUB_CHANGE)뿐 아니라 보기(GITHUB_VIEW)도 달라진다(권한 변경·노드 이동).
-- C++ 은 이 함수로 "다시 물어봐야 할 사람"과 그 결과(can_view, can_write)를 한 번에 얻어
-- collab 에게 통보한다. 판정 주체는 언제나 C++ 하나다(§12.9) — collab 은 받은 값을 전달만 한다.
--
-- 두 값의 뜻이 다르다.
--   - can_write=false: 그 세션을 읽기 전용으로 바꾼다(편집 잠금). 세션은 살려 둔다.
--   - can_view=false : 그 저장소를 더 이상 볼 수 없다는 뜻이므로 세션을 끝낸다(강제 이탈).
--     읽기만 막고 세션을 남겨 두면 방에 남아 다른 사람의 편집을 계속 받는다.
--
-- 대상은 두 조건을 모두 만족하는 사람이다.
--   1) 권한이 바뀐 노드의 서브트리에 연결된 저장소(github_repositories.node_id)
--      — 상위 노드의 권한은 하위로 상속되므로 하위 저장소도 다시 계산해야 한다.
--   2) 그 저장소의 브랜치에 지금 접속 중인 사람(github_branch_presence)
--      — 접속하지 않은 사람에게는 회수할 세션도, 알릴 곳도 없다.

CREATE OR REPLACE FUNCTION get_collab_permission_targets(
    p_node_id organization_nodes.node_id%TYPE
) RETURNS TABLE (
    repo_id INTEGER,
    repo_node_id INTEGER,
    user_email VARCHAR,
    can_view BOOLEAN,
    can_write BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    -- 1. 권한이 바뀐 노드와 그 하위 노드 전체(서브트리).
    WITH RECURSIVE subtree AS (
        SELECT p_node_id AS node_id
        UNION
        SELECT child.node_id
        FROM organization_nodes child
        JOIN subtree parent ON child.parent_node_id = parent.node_id
        WHERE child.is_deleted = FALSE
    )
    -- 2. 서브트리에 연결된 저장소마다, 지금 붙어 있는 사용자의 보기·쓰기 권한.
    --    쓰기 권한의 기준은 협업 편집 전체와 같은 GITHUB_CHANGE 다(§12.9, 브랜치 생성/삭제·커밋·push).
    --    보기 권한은 저장소 조회 API 와 같은 GITHUB_VIEW 다 — 이게 없어지면 세션을 끝낸다.
    SELECT r.repo_id,
           r.node_id,
           u.email,
           check_authority_with_override(u.user_id, r.node_id, 'GITHUB_VIEW'),
           check_authority_with_override(u.user_id, r.node_id, 'GITHUB_CHANGE')
    FROM github_repositories r
    JOIN subtree s ON s.node_id = r.node_id
    JOIN github_branches b ON b.repo_id = r.repo_id AND b.is_deleted = FALSE
    JOIN github_branch_presence p ON p.branch_id = b.branch_id
    JOIN users u ON u.email = p.user_email AND u.is_deleted = FALSE
    WHERE r.is_deleted = FALSE
    -- 한 사람이 여러 브랜치에 붙어 있어도 한 번만 돌려준다.
    GROUP BY r.repo_id, r.node_id, u.email, u.user_id;
END;
$$ LANGUAGE plpgsql;


-- 노드 삭제 시 협업 세션을 끊을 저장소 목록 (TASK_11 §12.9).
--
-- 노드는 소프트 딜리트라 저장소 행이 남고, 그 워크스페이스만 못 쓰게 된다. 그래서 "지금 붙어
-- 있는 세션을 끊는 일"과 "다시 못 붙게 막는 일"을 나눈다. 여기서는 전자만 계산한다 — 후자는
-- 접속자 등록(upsert_github_branch_presence, P0815)과 경로 해석(/internal/collab/resolve, P0815)이 막는다.
--
-- delete_node 는 트리거로 하위 노드를 연쇄 소프트 딜리트하므로 호출 시점에는 대상 노드와 그 자손이
-- 이미 is_deleted = TRUE 다. 그래서 노드의 is_deleted 는 보지 않고 그대로 훑는다(저장소만 살아 있으면 본다).
CREATE OR REPLACE FUNCTION get_collab_repos_in_subtree(
    p_node_id organization_nodes.node_id%TYPE
) RETURNS TABLE (
    repo_id INTEGER,
    node_id INTEGER
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE subtree AS (
        SELECT p_node_id AS node_id
        UNION
        SELECT child.node_id
        FROM organization_nodes child
        JOIN subtree parent ON child.parent_node_id = parent.node_id
    )
    SELECT r.repo_id, r.node_id
    FROM github_repositories r
    JOIN subtree s ON s.node_id = r.node_id
    WHERE r.is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql;

-- 주기적 권한 재확인 (TASK_11 §12.9).
--
-- 권한 변경은 C++ 통보(`get_collab_permission_targets` + `POST /internal/collab/permission`)가 밀어 준다.
-- 그 통보가 유실되는 경우가 있다 — 제어 소켓이 끊긴 채 문서 소켓만 남은(우회) 클라이언트, 통보 HTTP 의
-- 일시 실패, 노드 삭제를 놓친 경우다. 그래서 collab 이 자기 세션 목록(사용자 × 저장소)을 들고
-- 주기적으로 물어보는 길을 하나 더 둔다(안전망).
--
-- 흐름: collab(주기 타이머) → C++ `POST /internal/collab/permissions/recheck` → 이 함수.
-- 판정 주체는 여전히 C++(DB 함수) 하나다(§12.9) — collab 은 받은 값을 전달만 한다.
--
-- 세션이 더 이상 성립하지 않으면(저장소 연결 해제·노드 삭제·사용자 삭제) can_view=false 로 돌려준다.
-- collab 은 그런 세션을 끝낸다(강제 이탈) — 지워진 것을 계속 편집하게 두지 않는다.
CREATE OR REPLACE FUNCTION get_collab_session_permissions(
    p_sessions JSONB
) RETURNS TABLE (
    repo_id INTEGER,
    user_email VARCHAR,
    can_view BOOLEAN,
    can_write BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    -- CASE 로 감싸는 이유: 판정 함수는 사용자·노드가 실제로 있을 때만 부를 수 있다.
    -- (AND 는 평가 순서를 보장하지 않으므로 짧은 회로에 기대지 않는다.)
    SELECT s.repo_id,
           s.user_email,
           CASE
               WHEN r.repo_id IS NULL OR n.node_id IS NULL OR u.user_id IS NULL THEN FALSE
               ELSE check_authority_with_override(u.user_id, r.node_id, 'GITHUB_VIEW')
           END AS can_view,
           CASE
               WHEN r.repo_id IS NULL OR n.node_id IS NULL OR u.user_id IS NULL THEN FALSE
               ELSE check_authority_with_override(u.user_id, r.node_id, 'GITHUB_CHANGE')
           END AS can_write
    FROM jsonb_to_recordset(p_sessions) AS s(repo_id INTEGER, user_email VARCHAR)
    LEFT JOIN github_repositories r ON r.repo_id = s.repo_id AND r.is_deleted = FALSE
    LEFT JOIN organization_nodes n ON n.node_id = r.node_id AND n.is_deleted = FALSE
    LEFT JOIN users u ON u.email = s.user_email AND u.is_deleted = FALSE;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- collab 문맥 조회 보조 함수
--   티켓 발급과 경로 해석에 필요한 사용자·저장소·노드 정보를 한 번에 검증한다.
-- ---------------------------------------------------------------------------

-- Function: get_collab_ticket_context (CollabController::issueTicket)
-- 저장소 조회 권한(GITHUB_VIEW)과 쓰기 권한(GITHUB_CHANGE)을 함께 계산한다.
-- 검증 순서는 기존 C++ 흐름과 같다: 요청자 → 저장소 → 보기 권한 → 노드 생존.
CREATE OR REPLACE FUNCTION get_collab_ticket_context(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_requester_name users.name%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_can_write BOOLEAN;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id, name INTO v_requester_id, v_requester_name
    FROM users
    WHERE email = p_requester_email AND is_deleted = FALSE;

    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 저장소 보기 권한 확인
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'GITHUB_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have GITHUB_VIEW permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 저장소가 연결된 노드가 살아 있는지 확인
    IF NOT EXISTS (
        SELECT 1 FROM organization_nodes
        WHERE node_id = v_node_id AND is_deleted = FALSE
    ) THEN
        RAISE EXCEPTION '[P0815]Node of repository has been deleted: %', p_repo_id
        USING ERRCODE = 'P0815';
    END IF;

    -- 5. 협업 쓰기 권한 (브랜치 생성·삭제, 커밋, push 와 같은 기준)
    v_can_write := check_authority_with_override(v_requester_id, v_node_id, 'GITHUB_CHANGE');

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'COLLAB_TICKET_CONTEXT',
        'repo_id', p_repo_id,
        'node_id', v_node_id,
        'name', v_requester_name,
        'can_write', v_can_write
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' OR SQLSTATE 'P0815' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get collab ticket context: repo %, (REASON: %)',
                p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- Function: get_collab_worktree_context (CollabController::resolvePath /internal/collab/resolve)
-- 저장소와 브랜치가 모두 살아 있고, 저장소의 노드도 삭제되지 않았을 때
-- collab 이 쓸 경로 정보를 반환한다. 판정 주체는 계속 서버(DB 함수) 하나다.
CREATE OR REPLACE FUNCTION get_collab_worktree_context(
    p_repo_id github_repositories.repo_id%TYPE,
    p_branch_name github_branches.name%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_node_id organization_nodes.node_id%TYPE;
    v_local_path github_repositories.local_path%TYPE;
    v_default_branch github_repositories.default_branch%TYPE;
    v_worktree_path github_branches.worktree_path%TYPE;
    v_branch_name github_branches.name%TYPE;
BEGIN
    SELECT r.node_id, r.local_path, r.default_branch,
           b.worktree_path, b.name
    INTO v_node_id, v_local_path, v_default_branch,
         v_worktree_path, v_branch_name
    FROM github_repositories r
    JOIN github_branches b
      ON b.repo_id = r.repo_id
     AND b.name = p_branch_name
     AND b.is_deleted = FALSE
    WHERE r.repo_id = p_repo_id
      AND r.is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository or branch is not registered: % (repo %)',
            p_branch_name, p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM organization_nodes
        WHERE node_id = v_node_id AND is_deleted = FALSE
    ) THEN
        RAISE EXCEPTION '[P0815]Node of repository has been deleted: %', p_repo_id
        USING ERRCODE = 'P0815';
    END IF;

    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'COLLAB_WORKTREE_CONTEXT',
        'repo_id', p_repo_id,
        'node_id', v_node_id,
        'branch', v_branch_name,
        'local_path', v_local_path,
        'default_branch', v_default_branch,
        'worktree_path', v_worktree_path,
        'branch_slug', github_branch_slug(v_branch_name)
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0801' OR SQLSTATE 'P0815' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get collab worktree context: % (repo %), (REASON: %)',
                p_branch_name, p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;
