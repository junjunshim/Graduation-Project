-- 컨트롤러에서 사용될 github 관련 함수 생성
--
-- 권한 정책 (TASK_11 §3.2 + TASK_10 §4.5 승계)
--   - 조회(연결 목록·브랜치·접속자·자격증명 상태): 해당 노드 NODE_INFO_VIEW
--   - 저장소 연결/해제: 해당 노드 NODE_INFO_CHANGE (ADMIN 계열 — MANAGER 는 bit 12 가 없다)
--   - 브랜치 생성·삭제·커밋: WI_PERSONAL_CHANGE (작업자 이상 — VIEWER 는 불가)
--
-- 오류 코드 (P0801 ~ P0808) — P04xx 는 역할, P03xx 는 노드가 이미 쓰고 있어 대역을 분리했다.
--   P0801 저장소(또는 브랜치)가 연결되어 있지 않음
--   P0802 GitHub 자격증명이 없거나 무효
--   P0803 GitHub 토큰 스코프 부족 (컨트롤러가 GitHub API 응답으로 판정)
--   P0804 GitHub push 권한 없음 (컨트롤러 판정)
--   P0805 non-fast-forward (컨트롤러 판정)
--   P0806 GitHub 자격증명 암호화 키 미설정
--   P0807 저장소/자격증명 처리 실패 (기타)
--   P0808 저장소 clone 실패 (컨트롤러 판정)
--   (브랜치 삭제 가드 P0209/P0210 은 컨트롤러가 판정한다.)
--
-- access_token 은 어떤 응답에도 담지 않는다. 복호화를 돌려주는 함수는 get_github_user_token 하나뿐이며,
-- 그 반환값도 API 응답·로그·에러 메시지에 넣지 않는다 (§3.1 (5), §5).


-- Function: github_branch_slug (브랜치명 → worktree·협업 경로용 슬러그)
-- '/' 는 '__' 로, 영숫자·'-'·'_' 외 문자는 '_' 로 치환한다 (§14.4 BranchSlug 와 같은 규칙이어야 한다).
CREATE OR REPLACE FUNCTION github_branch_slug(
    p_name github_branches.name%TYPE
) RETURNS TEXT AS $$
BEGIN
    RETURN regexp_replace(replace(p_name, '/', '__'), '[^A-Za-z0-9_-]', '_', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- Function: github_parse_display_id (문자열에서 WI-<번호> 를 뽑아 업무 display_id 로 해석)
-- 'WI-101 로그인' 처럼 같은 절에서 인접할 때만 인정해 우연한 매칭(WI-1010, WI-101abc)을 막는다.
-- 브랜치 이름과 커밋 메시지가 같은 규칙을 쓰므로 두 곳에서 재사용한다 (TASK_10 §3.2·§3.3).
CREATE OR REPLACE FUNCTION github_parse_display_id(
    p_text TEXT
) RETURNS INTEGER AS $$
BEGIN
    RETURN NULLIF(substring(p_text from '(?:^|[^A-Za-z0-9])WI-([0-9]+)(?![A-Za-z0-9])'), '')::INTEGER;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- GitHubController::공통 - 저장소 단건 조회
-- repo_id 로 노드·clone 경로·기본 브랜치를 확정한다. 저장소를 다루는 모든 API 의 진입점이다.
CREATE OR REPLACE FUNCTION get_github_repository_by_id(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (연결된 노드를 볼 수 있어야 한다)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 저장소 정보 반환 (webhook_secret 등 비밀 값은 넣지 않는다)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_REPOSITORY',
        'repo_id', r.repo_id,
        'node_id', r.node_id,
        'owner_login', r.owner_login,
        'repo_name', r.repo_name,
        'clone_url', r.clone_url,
        'default_branch', r.default_branch,
        'local_path', r.local_path,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at
    )::jsonb AS out_data
    FROM github_repositories r
    WHERE r.repo_id = p_repo_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get github repository: %, (REASON: %)', p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::connectRepository
-- 저장소 연결(멱등). 같은 (노드, owner, 저장소)가 있으면 되살리고 없으면 새로 만든다.
-- clone 자체는 컨트롤러가 수행하고, 이 함수는 "어디에 clone 할지"를 확정한다 (§3.2).
CREATE OR REPLACE FUNCTION create_github_repository(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_owner_login github_repositories.owner_login%TYPE,
    p_repo_name github_repositories.repo_name%TYPE,
    p_clone_url github_repositories.clone_url%TYPE DEFAULT NULL,
    p_default_branch github_repositories.default_branch%TYPE DEFAULT 'main'
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_name organization_nodes.name%TYPE;
    v_repo_id github_repositories.repo_id%TYPE;
    v_clone_url github_repositories.clone_url%TYPE;
    v_local_path TEXT;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 존재 확인
    SELECT name INTO v_node_name FROM organization_nodes WHERE node_id = p_node_id AND is_deleted = FALSE;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 권한 확인 (연결은 ADMIN 계열만 가능하다)
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_CHANGE permission on node: %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. clone 주소와 서버 로컬 경로 확정 (§3.2: repository/<node_id>/<repo_name>)
    v_clone_url := COALESCE(NULLIF(p_clone_url, ''), 'https://github.com/' || p_owner_login || '/' || p_repo_name || '.git');
    v_local_path := 'repository/' || p_node_id::TEXT || '/' || p_repo_name;

    -- 5. 이미 활성 연결이 있으면 그 행을 그대로 쓴다 (같은 저장소를 두 번 만들지 않는다)
    SELECT repo_id INTO v_repo_id
    FROM github_repositories
    WHERE node_id = p_node_id AND owner_login = p_owner_login AND repo_name = p_repo_name AND is_deleted = FALSE;

    -- 6. 소프트 삭제된 행이 있으면 되살린다 (새 행을 만들면 기존 브랜치 이력이 끊긴다)
    IF v_repo_id IS NULL THEN
        UPDATE github_repositories
        SET is_deleted = FALSE,
            clone_url = v_clone_url,
            default_branch = p_default_branch,
            local_path = v_local_path,
            updated_at = CURRENT_TIMESTAMP
        WHERE repo_id = (
            SELECT repo_id FROM github_repositories
            WHERE node_id = p_node_id AND owner_login = p_owner_login AND repo_name = p_repo_name
            ORDER BY repo_id
            LIMIT 1
        )
        RETURNING repo_id INTO v_repo_id;
    END IF;

    -- 7. 처음 연결이면 새로 만든다
    IF v_repo_id IS NULL THEN
        INSERT INTO github_repositories (node_id, owner_login, repo_name, clone_url, default_branch, local_path)
        VALUES (p_node_id, p_owner_login, p_repo_name, v_clone_url, p_default_branch, v_local_path)
        RETURNING repo_id INTO v_repo_id;
    END IF;

    -- 8. 활동 피드 기록 (TASK_10 §4.6: 저장소 연결·해제는 'NODE' 활동으로 남긴다)
    PERFORM log_activity(
        p_node_id,
        p_requester_email,
        'NODE',
        p_node_id::VARCHAR,
        v_node_name,
        'updated',
        'github_repository',
        NULL,
        p_owner_login || '/' || p_repo_name
    );

    -- 9. 저장소 정보 반환 (토큰은 들어가지 않는다)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_REPOSITORY',
        'repo_id', r.repo_id,
        'node_id', r.node_id,
        'owner_login', r.owner_login,
        'repo_name', r.repo_name,
        'clone_url', r.clone_url,
        'default_branch', r.default_branch,
        'local_path', r.local_path,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at
    )::jsonb AS out_data
    FROM github_repositories r
    WHERE r.repo_id = v_repo_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to connect github repository: %/%, (REASON: %)', p_owner_login, p_repo_name, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::getRepositories
-- 노드에 연결된 저장소 목록 반환
CREATE OR REPLACE FUNCTION get_github_repositories_by_node(
    p_requester_email users.email%TYPE,
    p_node_id organization_nodes.node_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 노드 존재 확인
    IF NOT EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = p_node_id AND is_deleted = FALSE) THEN
        RAISE EXCEPTION '[P0002]Owner node does not exist or is deleted: %', p_node_id
        USING ERRCODE = 'P0002';
    END IF;

    -- 3. 권한 확인
    IF NOT check_authority_with_override(v_requester_id, p_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', p_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 연결된 저장소 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_REPOSITORY',
        'repo_id', r.repo_id,
        'node_id', r.node_id,
        'owner_login', r.owner_login,
        'repo_name', r.repo_name,
        'clone_url', r.clone_url,
        'default_branch', r.default_branch,
        'local_path', r.local_path,
        'is_deleted', r.is_deleted,
        'created_at', r.created_at,
        'updated_at', r.updated_at
    )::jsonb AS out_data
    FROM github_repositories r
    WHERE r.node_id = p_node_id AND r.is_deleted = FALSE
    ORDER BY r.repo_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0002' OR SQLSTATE 'P0103' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get github repositories of node: %, (REASON: %)', p_node_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::disconnectRepository
-- 연결 해제(소프트 삭제). 이 저장소의 브랜치와 접속자도 함께 정리한다.
-- worktree 제거는 컨트롤러가 git 으로 수행한다.
CREATE OR REPLACE FUNCTION delete_github_repository(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_node_name organization_nodes.name%TYPE;
    v_repo_label TEXT;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id, owner_login || '/' || repo_name INTO v_node_id, v_repo_label
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (해제도 연결과 같은 ADMIN 계열)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'NODE_INFO_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_CHANGE permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    SELECT name INTO v_node_name FROM organization_nodes WHERE node_id = v_node_id;

    -- 4. 접속자 정리 (휘발성 캐시. 남겨 두면 죽은 접속자가 계속 보인다)
    DELETE FROM github_branch_presence
    WHERE branch_id IN (SELECT branch_id FROM github_branches WHERE repo_id = p_repo_id);

    -- 5. 브랜치 소프트 삭제
    UPDATE github_branches
    SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    -- 6. 저장소 소프트 삭제
    UPDATE github_repositories
    SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE repo_id = p_repo_id;

    -- 7. 활동 피드 기록
    PERFORM log_activity(
        v_node_id,
        p_requester_email,
        'NODE',
        v_node_id::VARCHAR,
        v_node_name,
        'updated',
        'github_repository',
        v_repo_label,
        NULL
    );

    -- 8. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_REPOSITORY',
        'repo_id', r.repo_id,
        'node_id', r.node_id,
        'status', 'deleted',
        'is_deleted', r.is_deleted,
        'updated_at', r.updated_at
    )::jsonb AS out_data
    FROM github_repositories r
    WHERE r.repo_id = p_repo_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to disconnect github repository: %, (REASON: %)', p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::createBranch
-- 브랜치 생성(멱등). 이미 활성 브랜치가 있으면 그대로 돌려준다 (§3.2).
-- worktree 경로는 여기서 확정한다: <local_path>.worktrees/<slug>
CREATE OR REPLACE FUNCTION create_github_branch(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE,
    p_name github_branches.name%TYPE,
    p_base_branch github_branches.base_branch%TYPE DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_local_path github_repositories.local_path%TYPE;
    v_default_branch github_repositories.default_branch%TYPE;
    v_branch_id github_branches.branch_id%TYPE;
    v_worktree_path TEXT;
    v_display_id INTEGER;
    v_work_item_id work_items.work_item_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인 및 경로 수집
    SELECT node_id, local_path, default_branch
    INTO v_node_id, v_local_path, v_default_branch
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (브랜치 생성은 작업자 이상)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 이미 같은 이름의 활성 브랜치가 있으면 그대로 쓴다 (멱등)
    SELECT branch_id INTO v_branch_id
    FROM github_branches
    WHERE repo_id = p_repo_id AND name = p_name AND is_deleted = FALSE;

    IF v_branch_id IS NULL THEN
        -- 5. worktree 경로 확정 (브랜치 이름의 '/' 는 슬러그로 바꾼다)
        v_worktree_path := v_local_path || '.worktrees/' || github_branch_slug(p_name);

        -- 6. 브랜치 이름에서 WI-<번호> 를 파싱해 업무와 연결한다 (TASK_10 §3.3 A 경로)
        v_display_id := github_parse_display_id(p_name);
        IF v_display_id IS NOT NULL THEN
            SELECT w.work_item_id INTO v_work_item_id
            FROM work_items w
            WHERE w.owner_node_id = v_node_id AND w.display_id = v_display_id AND w.is_deleted = FALSE;
        END IF;

        -- 7. 브랜치 행 생성
        INSERT INTO github_branches (repo_id, name, base_branch, worktree_path, work_item_id, created_by_email)
        VALUES (
            p_repo_id,
            p_name,
            COALESCE(NULLIF(p_base_branch, ''), v_default_branch),
            v_worktree_path,
            v_work_item_id,
            p_requester_email
        )
        RETURNING branch_id INTO v_branch_id;
    END IF;

    -- 8. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_BRANCH',
        'branch_id', b.branch_id,
        'repo_id', b.repo_id,
        'name', b.name,
        'base_branch', b.base_branch,
        'worktree_path', b.worktree_path,
        'work_item_id', b.work_item_id,
        'work_item_display_id', w.display_id,
        'is_default', (b.name = r.default_branch),
        'created_by_email', b.created_by_email,
        'is_deleted', b.is_deleted,
        'created_at', b.created_at,
        'updated_at', b.updated_at
    )::jsonb AS out_data
    FROM github_branches b
    JOIN github_repositories r ON r.repo_id = b.repo_id
    LEFT JOIN work_items w ON w.work_item_id = b.work_item_id
    WHERE b.branch_id = v_branch_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to create github branch: % (repo %), (REASON: %)', p_name, p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::getBranches
-- 브랜치 목록 + 브랜치별 접속자 (§3.2). 원격에만 있는 브랜치는 컨트롤러가 git 으로 읽어 합친다.
CREATE OR REPLACE FUNCTION get_github_branches(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 브랜치 목록 반환 (접속자는 배열로 조립)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_BRANCH',
        'branch_id', b.branch_id,
        'repo_id', b.repo_id,
        'name', b.name,
        'base_branch', b.base_branch,
        'worktree_path', b.worktree_path,
        'work_item_id', b.work_item_id,
        'work_item_display_id', w.display_id,
        'is_default', (b.name = r.default_branch),
        'created_by_email', b.created_by_email,
        'created_at', b.created_at,
        'updated_at', b.updated_at,
        'presence', COALESCE(
            (
                SELECT jsonb_agg(
                    jsonb_build_object(
                        'email', gp.user_email,
                        'name', u.name,
                        'connection_id', gp.connection_id,
                        'connected_at', gp.connected_at,
                        'last_seen_at', gp.last_seen_at
                    ) ORDER BY gp.connected_at
                )
                FROM github_branch_presence gp
                JOIN users u ON u.email = gp.user_email
                WHERE gp.branch_id = b.branch_id
            ), '[]'::jsonb
        )
    )::jsonb AS out_data
    FROM github_branches b
    JOIN github_repositories r ON r.repo_id = b.repo_id
    LEFT JOIN work_items w ON w.work_item_id = b.work_item_id
    WHERE b.repo_id = p_repo_id AND b.is_deleted = FALSE
    ORDER BY b.name;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get github branches (repo %), (REASON: %)', p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::deleteBranch
-- 브랜치 소프트 삭제. DB 행만 정리하고 worktree 제거는 컨트롤러가 git 으로 수행한다.
-- 접속자 검사(P0209)·미커밋 변경 검사(P0210)는 §3.2 순서대로 컨트롤러가 먼저 판정한다.
CREATE OR REPLACE FUNCTION delete_github_branch(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE,
    p_name github_branches.name%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_branch_id github_branches.branch_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (브랜치 삭제도 작업자 이상)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 대상 브랜치 확인
    SELECT branch_id INTO v_branch_id
    FROM github_branches
    WHERE repo_id = p_repo_id AND name = p_name AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Branch is not registered on this repository: %', p_name
        USING ERRCODE = 'P0801';
    END IF;

    -- 5. 접속자 정리 (휘발성 캐시)
    DELETE FROM github_branch_presence WHERE branch_id = v_branch_id;

    -- 6. 소프트 삭제
    UPDATE github_branches
    SET is_deleted = TRUE, updated_at = CURRENT_TIMESTAMP
    WHERE branch_id = v_branch_id;

    -- 7. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_BRANCH',
        'branch_id', b.branch_id,
        'repo_id', b.repo_id,
        'name', b.name,
        'worktree_path', b.worktree_path,
        'status', 'deleted',
        'is_deleted', b.is_deleted,
        'updated_at', b.updated_at
    )::jsonb AS out_data
    FROM github_branches b
    WHERE b.branch_id = v_branch_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to delete github branch: % (repo %), (REASON: %)', p_name, p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::joinBranch (제어 소켓 /api/github/ws)
-- 접속 등록(멱등). 같은 connection_id 는 마지막으로 들어온 브랜치로 옮기고 last_seen_at 을 갱신한다.
-- 반환: 그 브랜치의 현재 접속자 목록 (presence_updated 브로드캐스트용)
CREATE OR REPLACE FUNCTION upsert_github_branch_presence(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE,
    p_branch_name github_branches.name%TYPE,
    p_connection_id github_branch_presence.connection_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_branch_id github_branches.branch_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (노드를 볼 수 있으면 접속 자체는 가능하다 — 읽기 전용 접속자도 목록에 남는다)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'NODE_INFO_VIEW') THEN
        RAISE EXCEPTION '[P0103]Requester does not have NODE_INFO_VIEW permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 대상 브랜치 확인
    SELECT branch_id INTO v_branch_id
    FROM github_branches
    WHERE repo_id = p_repo_id AND name = p_branch_name AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Branch is not registered on this repository: %', p_branch_name
        USING ERRCODE = 'P0801';
    END IF;

    -- 5. 접속 등록 (있으면 브랜치 이동 + heartbeat, 없으면 삽입)
    UPDATE github_branch_presence
    SET branch_id = v_branch_id,
        user_email = p_requester_email,
        last_seen_at = CURRENT_TIMESTAMP
    WHERE connection_id = p_connection_id;

    IF NOT FOUND THEN
        INSERT INTO github_branch_presence (branch_id, user_email, connection_id)
        VALUES (v_branch_id, p_requester_email, p_connection_id);
    END IF;

    -- 6. 그 브랜치의 접속자 목록 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_PRESENCE',
        'repo_id', b.repo_id,
        'branch', b.name,
        'email', gp.user_email,
        'name', u.name,
        'connection_id', gp.connection_id,
        'connected_at', gp.connected_at,
        'last_seen_at', gp.last_seen_at
    )::jsonb AS out_data
    FROM github_branch_presence gp
    JOIN github_branches b ON b.branch_id = gp.branch_id
    JOIN users u ON u.email = gp.user_email
    WHERE gp.branch_id = v_branch_id
    ORDER BY gp.connected_at;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to register branch presence: % (repo %), (REASON: %)', p_branch_name, p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::leaveBranch (제어 소켓 /api/github/ws)
-- 접속 해제. 소켓이 끊기거나 다른 브랜치로 옮길 때 호출한다.
-- 반환: 해제된 접속 1건. 대상이 없으면 0건을 돌려주므로 브로드캐스트를 건너뛰면 된다.
CREATE OR REPLACE FUNCTION delete_github_branch_presence(
    p_requester_email users.email%TYPE,
    p_connection_id github_branch_presence.connection_id%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_branch_id github_branches.branch_id%TYPE;
    v_branch_name github_branches.name%TYPE;
    v_repo_id github_repositories.repo_id%TYPE;
    v_email users.email%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 해제 대상 조회 (없으면 조용히 0건 — 이미 끊긴 소켓을 정리하는 경로이기 때문)
    SELECT gp.branch_id, gp.user_email, b.name, b.repo_id
    INTO v_branch_id, v_email, v_branch_name, v_repo_id
    FROM github_branch_presence gp
    JOIN github_branches b ON b.branch_id = gp.branch_id
    WHERE gp.connection_id = p_connection_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- 3. 삭제
    DELETE FROM github_branch_presence WHERE connection_id = p_connection_id;

    -- 4. 해제된 접속 정보 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_PRESENCE',
        'repo_id', v_repo_id,
        'branch', v_branch_name,
        'email', v_email,
        'connection_id', p_connection_id
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to release branch presence: %, (REASON: %)', p_connection_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::commit
-- 커밋 기록. 업무 상태 자동 전환은 컨트롤러가 기존 update_work_item 으로 수행한다 (TASK_10 규칙).
-- 배지 조건은 두 가지다 — 매칭 실패(matched_work_item_id IS NULL), push 실패(pushed = FALSE, §12.11).
CREATE OR REPLACE FUNCTION create_github_commit_log(
    p_requester_email users.email%TYPE,
    p_repo_id github_repositories.repo_id%TYPE,
    p_branch_name github_branches.name%TYPE,
    p_sha github_commit_logs.sha%TYPE,
    p_author_email github_commit_logs.author_email%TYPE,
    p_message github_commit_logs.message%TYPE,
    p_pushed github_commit_logs.pushed%TYPE DEFAULT FALSE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_node_id organization_nodes.node_id%TYPE;
    v_branch_id github_branches.branch_id%TYPE;
    v_display_id INTEGER;
    v_matched_work_item_id work_items.work_item_id%TYPE;
    v_commit_log_id github_commit_logs.commit_log_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 저장소 존재 확인
    SELECT node_id INTO v_node_id
    FROM github_repositories
    WHERE repo_id = p_repo_id AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0801]Repository is not connected: %', p_repo_id
        USING ERRCODE = 'P0801';
    END IF;

    -- 3. 권한 확인 (커밋은 작업자 이상)
    IF NOT check_authority_with_override(v_requester_id, v_node_id, 'WI_PERSONAL_CHANGE') THEN
        RAISE EXCEPTION '[P0103]Requester does not have WI_PERSONAL_CHANGE permission on node: %', v_node_id
        USING ERRCODE = 'P0103';
    END IF;

    -- 4. 브랜치 행이 있으면 연결한다 (없으면 NULL — 커밋 기록 자체는 남긴다)
    SELECT branch_id INTO v_branch_id
    FROM github_branches
    WHERE repo_id = p_repo_id AND name = p_branch_name AND is_deleted = FALSE;

    -- 5. 커밋 메시지의 WI-<번호> 를 업무로 해석한다 (TASK_10 §3.2: 커밋 단위에서는 메시지가 1순위)
    --    'WI-101 로그인' 처럼 같은 절에서 인접할 때만 인정해 우연한 매칭을 막는다.
    v_display_id := github_parse_display_id(p_message);
    IF v_display_id IS NOT NULL THEN
        SELECT w.work_item_id INTO v_matched_work_item_id
        FROM work_items w
        WHERE w.owner_node_id = v_node_id AND w.display_id = v_display_id AND w.is_deleted = FALSE;
    END IF;

    -- 6. 기록 (push 가 실패했으면 pushed_by_email 을 NULL 로 남긴다 — §12.11)
    INSERT INTO github_commit_logs (
        repo_id, branch_id, sha, author_email, pushed_by_email, message, matched_work_item_id, pushed
    ) VALUES (
        p_repo_id,
        v_branch_id,
        p_sha,
        p_author_email,
        CASE WHEN p_pushed THEN p_requester_email ELSE NULL END,
        p_message,
        v_matched_work_item_id,
        p_pushed
    )
    RETURNING commit_log_id INTO v_commit_log_id;

    -- 7. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_COMMIT',
        'commit_log_id', cl.commit_log_id,
        'repo_id', cl.repo_id,
        'branch_id', cl.branch_id,
        'branch', p_branch_name,
        'sha', cl.sha,
        'message', cl.message,
        'author_email', cl.author_email,
        'pushed_by_email', cl.pushed_by_email,
        'matched_work_item_id', cl.matched_work_item_id,
        'matched_display_id', w.display_id,
        'matched_work_item_status', w.status,
        'pushed', cl.pushed,
        'created_at', cl.created_at
    )::jsonb AS out_data
    FROM github_commit_logs cl
    LEFT JOIN work_items w ON w.work_item_id = cl.matched_work_item_id
    WHERE cl.commit_log_id = v_commit_log_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0103' OR SQLSTATE 'P0801' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to record github commit: % (repo %), (REASON: %)', p_sha, p_repo_id, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::registerCredential (§6-11: PAT 직접 입력)
-- access_token 은 pgp_sym_encrypt 로 암호화해 저장한다. 이 함수는 토큰을 돌려주지 않는다.
-- p_enc_key 는 컨트롤러가 환경변수(GITHUB_TOKEN_KEY)에서 읽어 넘긴다. 없으면 저장하지 않는다(fail-closed).
CREATE OR REPLACE FUNCTION upsert_github_user_credential(
    p_requester_email users.email%TYPE,
    p_github_login github_user_credentials.github_login%TYPE,
    p_token TEXT,
    p_enc_key TEXT,
    p_token_type github_user_credentials.token_type%TYPE DEFAULT 'pat',
    p_scopes github_user_credentials.scopes%TYPE DEFAULT NULL,
    p_expires_at github_user_credentials.expires_at%TYPE DEFAULT NULL
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_credential_id github_user_credentials.credential_id%TYPE;
BEGIN
    -- 1. 요청자 확인 (자격증명은 본인 것만 다룬다)
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 암호화 키와 토큰은 비어 있으면 안 된다 (키가 없으면 평문 저장으로 흘러가므로 거부한다)
    IF p_enc_key IS NULL OR p_enc_key = '' THEN
        RAISE EXCEPTION '[P0806]Encryption key is not configured'
        USING ERRCODE = 'P0806';
    END IF;

    IF p_token IS NULL OR p_token = '' THEN
        RAISE EXCEPTION '[P0802]GitHub token is empty for user: %', p_requester_email
        USING ERRCODE = 'P0802';
    END IF;

    -- 3. 사용자당 활성 자격증명 1개 — 있으면 갱신, 없으면 삽입
    UPDATE github_user_credentials
    SET github_login = p_github_login,
        access_token = encode(pgp_sym_encrypt(p_token, p_enc_key), 'base64'),
        token_type = p_token_type,
        scopes = p_scopes,
        expires_at = p_expires_at,
        is_deleted = FALSE,
        updated_at = CURRENT_TIMESTAMP
    WHERE credential_id = (
        SELECT credential_id FROM github_user_credentials
        WHERE user_email = p_requester_email
        ORDER BY credential_id
        LIMIT 1
    )
    RETURNING credential_id INTO v_credential_id;

    IF v_credential_id IS NULL THEN
        INSERT INTO github_user_credentials (user_email, github_login, access_token, token_type, scopes, expires_at)
        VALUES (
            p_requester_email,
            p_github_login,
            encode(pgp_sym_encrypt(p_token, p_enc_key), 'base64'),
            p_token_type,
            p_scopes,
            p_expires_at
        )
        RETURNING credential_id INTO v_credential_id;
    END IF;

    -- 4. 메타데이터만 반환한다 (토큰도 암호문도 응답에 넣지 않는다)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_CREDENTIAL',
        'credential_id', c.credential_id,
        'has_credential', TRUE,
        'github_login', c.github_login,
        'token_type', c.token_type,
        'scopes', c.scopes,
        'expires_at', c.expires_at,
        'updated_at', c.updated_at
    )::jsonb AS out_data
    FROM github_user_credentials c
    WHERE c.credential_id = v_credential_id;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0802' OR SQLSTATE 'P0806' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to save github credential: %, (REASON: %)', p_requester_email, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::getCredentialStatus
-- 내 GitHub 자격증명 상태(login·스코프·만료). 자격증명이 없어도 1행을 돌려준다(has_credential = FALSE).
CREATE OR REPLACE FUNCTION get_github_user_credential(
    p_requester_email users.email%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_credential_id github_user_credentials.credential_id%TYPE;
    v_github_login github_user_credentials.github_login%TYPE;
    v_token_type github_user_credentials.token_type%TYPE;
    v_scopes github_user_credentials.scopes%TYPE;
    v_expires_at github_user_credentials.expires_at%TYPE;
    v_updated_at github_user_credentials.updated_at%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 활성 자격증명 조회 (없으면 변수가 NULL 로 남아 has_credential = FALSE 가 된다)
    SELECT credential_id, github_login, token_type, scopes, expires_at, updated_at
    INTO v_credential_id, v_github_login, v_token_type, v_scopes, v_expires_at, v_updated_at
    FROM github_user_credentials
    WHERE user_email = p_requester_email AND is_deleted = FALSE
    ORDER BY credential_id
    LIMIT 1;

    -- 3. 상태 반환 (access_token 은 절대 포함하지 않는다)
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_CREDENTIAL',
        'credential_id', v_credential_id,
        'has_credential', (v_credential_id IS NOT NULL),
        'github_login', v_github_login,
        'token_type', v_token_type,
        'scopes', v_scopes,
        'expires_at', v_expires_at,
        'updated_at', v_updated_at
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to get github credential: %, (REASON: %)', p_requester_email, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::내부 전용 - push/clone 에 쓸 복호화된 토큰
-- 이 반환값은 API 응답·로그·에러 메시지 어디에도 넣지 않는다 (§5). 응답용 조회는 get_github_user_credential 을 쓴다.
CREATE OR REPLACE FUNCTION get_github_user_token(
    p_requester_email users.email%TYPE,
    p_enc_key TEXT
) RETURNS TEXT AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
    v_access_token github_user_credentials.access_token%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 암호화 키 확인
    IF p_enc_key IS NULL OR p_enc_key = '' THEN
        RAISE EXCEPTION '[P0806]Encryption key is not configured'
        USING ERRCODE = 'P0806';
    END IF;

    -- 3. 활성 자격증명 확인
    SELECT access_token INTO v_access_token
    FROM github_user_credentials
    WHERE user_email = p_requester_email AND is_deleted = FALSE
    ORDER BY credential_id
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0802]GitHub credential is not registered: %', p_requester_email
        USING ERRCODE = 'P0802';
    END IF;

    -- 4. 복호화해 반환
    RETURN pgp_sym_decrypt(decode(v_access_token, 'base64'), p_enc_key);

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0802' OR SQLSTATE 'P0806' THEN
            RAISE;
        WHEN OTHERS THEN
            -- SQLERRM 에는 토큰 값이 들어가지 않는다. 파라미터를 메시지에 넣지 않는 이유이기도 하다.
            RAISE EXCEPTION '[P0807]Failed to decrypt github credential: %, (REASON: %)', p_requester_email, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;


-- GitHubController::disconnectCredential
-- 자격증명 연결 해제(소프트 삭제). 재등록은 같은 행을 되살리므로 이력이 남는다.
CREATE OR REPLACE FUNCTION delete_github_user_credential(
    p_requester_email users.email%TYPE
) RETURNS SETOF integrated_data AS $$
DECLARE
    v_requester_id users.user_id%TYPE;
BEGIN
    -- 1. 요청자 확인
    SELECT user_id INTO v_requester_id FROM users WHERE email = p_requester_email AND is_deleted = FALSE;
    IF v_requester_id IS NULL THEN
        RAISE EXCEPTION '[P0001]Requester user does not exist: %', p_requester_email
        USING ERRCODE = 'P0001';
    END IF;

    -- 2. 소프트 삭제 + 암호문 비우기 (해제는 토큰 폐기와 같다. 남겨 두면 되살릴 이유가 없다)
    UPDATE github_user_credentials
    SET is_deleted = TRUE,
        access_token = '',
        github_login = NULL,
        scopes = NULL,
        expires_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_email = p_requester_email AND is_deleted = FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0802]GitHub credential is not registered: %', p_requester_email
        USING ERRCODE = 'P0802';
    END IF;

    -- 3. 결과 반환
    RETURN QUERY
    SELECT jsonb_build_object(
        'type', 'GITHUB_CREDENTIAL',
        'has_credential', FALSE,
        'status', 'deleted'
    )::jsonb AS out_data;

    EXCEPTION
        WHEN SQLSTATE 'P0001' OR SQLSTATE 'P0802' THEN
            RAISE;
        WHEN OTHERS THEN
            RAISE EXCEPTION '[P0807]Failed to delete github credential: %, (REASON: %)', p_requester_email, SQLERRM
            USING ERRCODE = 'P0807';
END;
$$ LANGUAGE plpgsql;
