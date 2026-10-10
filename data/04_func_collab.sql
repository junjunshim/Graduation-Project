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