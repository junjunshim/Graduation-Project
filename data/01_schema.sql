-- 0. 확장 프로그램 및 enum 타입 정의
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TYPE IF EXISTS history_status CASCADE;
CREATE TYPE history_status AS ENUM ('inserted', 'updated', 'deleted');


-- 1. organization_nodes - 모든 공간과 주체의 트리 구조 
CREATE TABLE IF NOT EXISTS organization_nodes (
    node_id SERIAL PRIMARY KEY,
    node_type VARCHAR(100) NOT NULL,
    parent_node_id INTEGER REFERENCES organization_nodes(node_id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    path INTEGER[] NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_nodes_path ON organization_nodes USING GIN (path);
CREATE INDEX idx_nodes_is_deleted ON organization_nodes(is_deleted);


-- 2. users - 서비스 이용자 정보
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash TEXT NOT NULL,
    personal_node_id INTEGER REFERENCES organization_nodes(node_id) ON DELETE SET NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_users_is_deleted ON users(is_deleted);
-- 이메일은 대소문자와 앞뒤 공백을 정규화한 값으로 한 계정만 허용한다.
CREATE UNIQUE INDEX IF NOT EXISTS unique_users_email_normalized ON users(lower(trim(email)));


-- 3. 유저와 노드 간이 권한 매핑
CREATE TABLE IF NOT EXISTS role_assignments (
    assignment_id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL,
    is_top_role BOOLEAN NOT NULL DEFAULT FALSE, -- 정의의 속성을 FK로 검증하는 내부 무결성 컬럼
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_assignments UNIQUE (user_id, node_id)
);
CREATE INDEX idx_assignments_user_id ON role_assignments(user_id);
CREATE INDEX idx_assignments_node_id ON role_assignments(node_id);


-- 4. 노드의 각 권한의 범위
CREATE TABLE IF NOT EXISTS role_authorities (
    authority_id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    authority authority_mask NOT NULL, -- Bitmask 권한 (정의: data/00_domain_authority.sql)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_top_role BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT unique_authorities UNIQUE (node_id, role),
    CONSTRAINT unique_authority_node_id UNIQUE (node_id, authority_id, is_top_role)
);
CREATE INDEX idx_authorities_node_id ON role_authorities(node_id);
CREATE UNIQUE INDEX unique_top_role ON role_authorities(node_id) WHERE is_top_role;
ALTER TABLE role_assignments ADD CONSTRAINT assignment_role_fk FOREIGN KEY (node_id, role_id, is_top_role)
    REFERENCES role_authorities(node_id, authority_id, is_top_role);
CREATE UNIQUE INDEX unique_top_assignee ON role_assignments(node_id) WHERE is_top_role;
CREATE INDEX idx_assignments_role_id ON role_assignments(role_id);

-- 4.1 권한 상수 테이블 (하드코딩 방지)
CREATE TABLE IF NOT EXISTS authority_constants (
    constant_id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    bit_position INTEGER NOT NULL CHECK (bit_position >= 0 AND bit_position < authority_bit_length()),
    description TEXT
);

-- 4.2 역할별 기본 권한 테이블
CREATE TABLE IF NOT EXISTS role_defaults (
    role VARCHAR(50) PRIMARY KEY,
    default_authority authority_mask NOT NULL,
    is_top_role BOOLEAN NOT NULL DEFAULT FALSE
);

-- 5. 업무와 프로젝트 데이터
CREATE TABLE IF NOT EXISTS work_items (
    work_item_id VARCHAR(50) PRIMARY KEY,
    display_id INTEGER NOT NULL,
    owner_node_id INTEGER REFERENCES organization_nodes(node_id) ON DELETE SET NULL,
    parent_work_item_id VARCHAR(50) REFERENCES work_items(work_item_id) ON DELETE SET NULL,
    owner_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    status  VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    weight INTEGER NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100), -- 하위 업무가 차지하는 비중(%)
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_dates CHECK (due_date >= start_date),
    -- 완료 상태는 항상 자체 진행률 100%를 가진다(진행률 100%인 미완료 업무는 허용).
    CONSTRAINT check_done_progress CHECK (status <> 'done' OR progress = 100),
    CONSTRAINT uq_work_items_node_display UNIQUE (owner_node_id, display_id)
);
CREATE INDEX idx_work_items_node_id ON work_items(owner_node_id);
CREATE INDEX idx_work_items_node_display ON work_items(owner_node_id, display_id);
CREATE INDEX idx_work_items_user_id ON work_items(owner_user_id);
CREATE INDEX idx_work_items_parent_id ON work_items(parent_work_item_id);
CREATE INDEX idx_work_items_is_deleted ON work_items(is_deleted);


-- 6. user의 refresh token
CREATE TABLE IF NOT EXISTS user_refresh_tokens (
    user_email VARCHAR(100) PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);


-- 6.1 비밀번호 재설정 토큰
-- 링크에 들어가는 원문 토큰은 저장하지 않고 SHA-256 해시만 보관한다.
-- 한 사용자에게 활성 토큰 하나만 허용하며, 재요청 시 기존 토큰을 먼저 소비 처리한다.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    reset_id SERIAL PRIMARY KEY,
    user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_email
    ON password_reset_tokens(user_email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_password_reset_token
    ON password_reset_tokens(user_email)
    WHERE used_at IS NULL;


-- 6.2 회원가입 이메일 인증
-- 인증번호는 bcrypt 해시로, 인증 완료 토큰은 SHA-256 해시로만 보관한다.
CREATE TABLE IF NOT EXISTS signup_email_verifications (
    verification_id SERIAL PRIMARY KEY,
    email VARCHAR(100) NOT NULL,
    code_hash TEXT NOT NULL,
    code_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
    verified_at TIMESTAMP WITH TIME ZONE,
    verification_token_hash CHAR(64) UNIQUE,
    token_expires_at TIMESTAMP WITH TIME ZONE,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_signup_email_normalized CHECK (email = lower(trim(email)))
);
CREATE INDEX IF NOT EXISTS idx_signup_email_verifications_email
    ON signup_email_verifications(email, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_signup_email_verification
    ON signup_email_verifications(email)
    WHERE consumed_at IS NULL;


-- 7. 복구용 테이블 생성 (외래키 제약조건 없음)
CREATE TABLE user_histories (
    history_id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    password_hash TEXT NOT NULL,
    personal_node_id INTEGER,
    is_deleted BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    change_status history_status NOT NULL,
    history_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_user_history_user_id ON user_histories(user_id);


CREATE TABLE organization_node_histories (
    history_id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL,
    node_type VARCHAR(100) NOT NULL,
    parent_node_id INTEGER,
    name VARCHAR(100) NOT NULL,
    path INTEGER[] NOT NULL,
    is_deleted BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    change_status history_status NOT NULL,
    history_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_node_history_node_id ON organization_node_histories(node_id);


CREATE TABLE role_assignment_histories (
    role_id INTEGER,
    history_id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    node_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    change_status history_status NOT NULL,
    history_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_assignment_history_assignment_id ON role_assignment_histories(assignment_id);
CREATE INDEX idx_assignment_history_user_id ON role_assignment_histories(user_id);
CREATE INDEX idx_assignment_history_node_id ON role_assignment_histories(node_id);


CREATE TABLE role_authority_histories (
    is_top_role BOOLEAN NOT NULL DEFAULT FALSE,
    history_id SERIAL PRIMARY KEY,
    authority_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    authority authority_mask NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    change_status history_status NOT NULL,
    history_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_authority_history_authority_id ON role_authority_histories(authority_id);
CREATE INDEX idx_authority_history_node_id ON role_authority_histories(node_id);


CREATE TABLE work_item_histories (
    history_id SERIAL PRIMARY KEY,
    work_item_id VARCHAR(50) NOT NULL,
    display_id INTEGER NOT NULL,
    owner_node_id INTEGER NOT NULL,
    parent_work_item_id VARCHAR(50),
    owner_user_id VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    hidden BOOLEAN NOT NULL,
    status VARCHAR(20) NOT NULL,
    priority INTEGER NOT NULL,
    weight INTEGER NOT NULL,
    progress INTEGER NOT NULL,
    is_deleted BOOLEAN NOT NULL,
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    change_status history_status NOT NULL,
    history_created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_history_work_item_id ON work_item_histories(work_item_id);
CREATE INDEX idx_history_owner_node_id ON work_item_histories(owner_node_id);
CREATE INDEX idx_history_owner_user_id ON work_item_histories(owner_user_id);


-- 8. 최근 활동 로그 테이블 (클라이언트 타임라인 피드용)
CREATE TABLE IF NOT EXISTS activity_logs (
    log_id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    actor_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    actor_name VARCHAR(100) NOT NULL,    -- 수행자 이름 캐싱 (김철수 등)
    entity_type VARCHAR(20) NOT NULL,     -- 'NODE', 'WORK_ITEM', 'ROLE', 'AUTHORITY', 'COMMENT'
    entity_id VARCHAR(50) NOT NULL,       -- 객체 고유 ID
    target_name VARCHAR(200) NOT NULL,    -- 대상 객체 대표 명칭 캐싱 (업무 제목, 노드 명 등)
    action_type VARCHAR(20) NOT NULL,     -- 'inserted', 'updated', 'deleted', 'restored'
    field_name VARCHAR(50),               -- 변경된 필드명 (예: 'status', 'title', 'role' 등)
    old_value TEXT,                      -- 이전 값
    new_value TEXT,                      -- 변경된 값
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_activity_logs_node_id ON activity_logs(node_id);
CREATE INDEX idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- 9. 업무 댓글 및 멘션 알림 테이블
CREATE TABLE IF NOT EXISTS work_item_comments (
    comment_id SERIAL PRIMARY KEY,
    work_item_id VARCHAR(50) NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    author_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comments_work_item_id ON work_item_comments(work_item_id);

CREATE TABLE IF NOT EXISTS comment_mentions (
    mention_id SERIAL PRIMARY KEY,
    comment_id INTEGER NOT NULL REFERENCES work_item_comments(comment_id) ON DELETE CASCADE,
    mentioned_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mentions_comment_id ON comment_mentions(comment_id);
CREATE INDEX idx_mentions_user_id ON comment_mentions(mentioned_user_id);

-- 10. 업무 첨부 파일 테이블
CREATE TABLE IF NOT EXISTS work_item_files (
    file_id SERIAL PRIMARY KEY,
    work_item_id VARCHAR(50) NOT NULL REFERENCES work_items(work_item_id) ON DELETE CASCADE,
    uploader_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_files_work_item_id ON work_item_files(work_item_id);
CREATE INDEX idx_files_is_deleted ON work_item_files(is_deleted);

-- 11. 정기/반복 일정 및 루틴 규칙 테이블
CREATE TABLE IF NOT EXISTS recurring_rules (
    rule_id SERIAL PRIMARY KEY,
    owner_node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    creator_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assignee_user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL DEFAULT 'ROUTINE', -- 'ROUTINE', 'REPORT', 'INSPECTION', 'MEETING', 'EVENT'
    
    -- 반복 주기 속성
    frequency VARCHAR(20) NOT NULL,          -- 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'
    interval_value INTEGER NOT NULL DEFAULT 1, -- N일/N주/N개월 주기
    by_day VARCHAR(50),                      -- 주간 요일 ('MO', 'TU,TH', 'MO,WE,FR')
    by_month_day INTEGER,                    -- 월간 일자 (1~31)
    by_set_pos INTEGER,                      -- 주차 (1: 첫째주, 2: 둘째주 ... -1: 마지막주)
    
    -- 시간 및 유효 기간
    start_time TIME,                         -- 시작 시간 (예: '10:00:00')
    duration_minutes INTEGER DEFAULT 60,     -- 소요 시간(분)
    repeat_start_date DATE NOT NULL,         -- 반복 시작 기준일
    repeat_end_date DATE,                    -- 반복 종료일 (NULL: 무기한)
    max_occurrences INTEGER,                 -- 최대 반복 횟수
    
    -- 공휴일 처리 정책
    exclude_holidays BOOLEAN NOT NULL DEFAULT TRUE,
    holiday_action VARCHAR(20) NOT NULL DEFAULT 'SKIP', -- 'SKIP' | 'NEXT_WORKDAY' | 'PREV_WORKDAY'
    
    -- 실행 모드
    auto_create_task BOOLEAN NOT NULL DEFAULT FALSE,
    
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_recurring_rules_node ON recurring_rules(owner_node_id);
CREATE INDEX idx_recurring_rules_creator ON recurring_rules(creator_user_id);
CREATE INDEX idx_recurring_rules_category ON recurring_rules(category);
CREATE INDEX idx_recurring_rules_active ON recurring_rules(is_active, is_deleted);

-- 12. 정기 일정 체크리스트 템플릿 테이블
CREATE TABLE IF NOT EXISTS recurring_rule_checklists (
    checklist_id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES recurring_rules(rule_id) ON DELETE CASCADE,
    content VARCHAR(255) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_recurring_checklists_rule ON recurring_rule_checklists(rule_id);

-- 13. 정기 일정 전용 독립 첨부파일 테이블 (양식, 매뉴얼 등)
CREATE TABLE IF NOT EXISTS recurring_rule_files (
    file_id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES recurring_rules(rule_id) ON DELETE CASCADE,
    uploader_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_recurring_files_rule_id ON recurring_rule_files(rule_id);
CREATE INDEX idx_recurring_files_is_deleted ON recurring_rule_files(is_deleted);

-- 14. GitHub 저장소 연결 테이블 (워크스페이스 ↔ 원격 저장소)
CREATE TABLE IF NOT EXISTS github_repositories (
    repo_id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    owner_login VARCHAR(100) NOT NULL,
    repo_name VARCHAR(200) NOT NULL,
    clone_url TEXT NOT NULL,
    default_branch VARCHAR(200) NOT NULL DEFAULT 'main',
    local_path TEXT NOT NULL,
    webhook_secret TEXT, -- 2차 webhook 용 (1차는 미사용)
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- 같은 노드에 같은 저장소를 두 번 연결하지 않는다 (소프트 삭제된 행은 제외)
CREATE UNIQUE INDEX unique_repo_per_node ON github_repositories(node_id, owner_login, repo_name) WHERE NOT is_deleted;
CREATE INDEX idx_github_repos_node_id ON github_repositories(node_id);
CREATE INDEX idx_github_repos_is_deleted ON github_repositories(is_deleted);

-- 15. GitHub 브랜치 테이블 (브랜치별 worktree)
CREATE TABLE IF NOT EXISTS github_branches (
    branch_id SERIAL PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES github_repositories(repo_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    base_branch VARCHAR(255), -- 생성 시 기준 브랜치
    worktree_path TEXT,       -- 서버 worktree 경로
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, -- 마지막 사용 시각 — worktree 회수 판정(§13.8)
    work_item_id VARCHAR(50) REFERENCES work_items(work_item_id) ON DELETE SET NULL, -- 브랜치명 파싱 결과 (WI-101)
    created_by_email VARCHAR(100) REFERENCES users(email) ON DELETE SET NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX unique_branch_per_repo ON github_branches(repo_id, name) WHERE NOT is_deleted;
CREATE INDEX idx_github_branches_repo_id ON github_branches(repo_id);
CREATE INDEX idx_github_branches_work_item_id ON github_branches(work_item_id);
CREATE INDEX idx_github_branches_is_deleted ON github_branches(is_deleted);
CREATE INDEX idx_github_branches_last_used_at ON github_branches(last_used_at);

-- 16. GitHub 브랜치 접속자 테이블 (휘발성 캐시 — 진실 원천은 WebSocket 연결 상태)
CREATE TABLE IF NOT EXISTS github_branch_presence (
    presence_id SERIAL PRIMARY KEY,
    branch_id INTEGER NOT NULL REFERENCES github_branches(branch_id) ON DELETE CASCADE,
    user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    connection_id VARCHAR(100) NOT NULL, -- 확장 세션 식별자
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_github_presence_branch_id ON github_branch_presence(branch_id);
CREATE INDEX idx_github_presence_connection_id ON github_branch_presence(connection_id);
CREATE INDEX idx_github_presence_user_email ON github_branch_presence(user_email);
CREATE INDEX idx_github_presence_last_seen_at ON github_branch_presence(last_seen_at);

-- 17. GitHub 커밋 기록 테이블
CREATE TABLE IF NOT EXISTS github_commit_logs (
    commit_log_id SERIAL PRIMARY KEY,
    repo_id INTEGER NOT NULL REFERENCES github_repositories(repo_id) ON DELETE CASCADE,
    branch_id INTEGER REFERENCES github_branches(branch_id) ON DELETE SET NULL,
    sha VARCHAR(40) NOT NULL,
    author_email VARCHAR(100), -- 우리 users.email 기준 (매칭 실패 시 NULL)
    pushed_by_email VARCHAR(100) REFERENCES users(email) ON DELETE SET NULL, -- 실제 push 한 사용자
    message TEXT,
    matched_work_item_id VARCHAR(50) REFERENCES work_items(work_item_id) ON DELETE SET NULL, -- 커밋 메시지 파싱 결과
    pushed BOOLEAN NOT NULL DEFAULT FALSE, -- 원격 push 성공 여부
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_github_commits_repo_id ON github_commit_logs(repo_id);
CREATE INDEX idx_github_commits_branch_id ON github_commit_logs(branch_id);
CREATE INDEX idx_github_commits_author_email ON github_commit_logs(author_email);
CREATE INDEX idx_github_commits_matched_work_item_id ON github_commit_logs(matched_work_item_id);

-- 18. 사용자 GitHub 자격증명 테이블 (PAT, access_token 은 암호화 저장)
CREATE TABLE IF NOT EXISTS github_user_credentials (
    credential_id SERIAL PRIMARY KEY,
    user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    github_login VARCHAR(100), -- 토큰이 속한 GitHub 계정 (표시·배지용)
    access_token TEXT NOT NULL, -- 평문 금지: pgp_sym_encrypt 등으로 암호화
    token_type VARCHAR(20) NOT NULL DEFAULT 'pat', -- 'pat' | 'oauth' | 'installation'
    scopes VARCHAR(200),
    expires_at TIMESTAMP WITH TIME ZONE, -- OAuth·installation 만료 (PAT 는 NULL)
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- 사용자당 활성 자격증명 1개
CREATE UNIQUE INDEX unique_credential_per_user ON github_user_credentials(user_email) WHERE NOT is_deleted;
CREATE INDEX idx_github_credentials_is_deleted ON github_user_credentials(is_deleted);

-- 19. GitHub 확장 토큰 테이블 (VSCode 확장 전용 리프레시 토큰)
-- 앱의 user_refresh_tokens 는 user_email 이 PK 라 사용자당 1개뿐이다.
-- 확장이 같은 테이블을 쓰면 앱과 서로의 세션을 무효화하므로 확장 전용으로 분리한다.
-- 여러 기기에서 동시에 로그인할 수 있도록 사용자당 여러 행을 허용하고, 갱신(rotate)은
-- refresh_token 값으로 행을 찾아 원자적으로 회전시킨다.
CREATE TABLE IF NOT EXISTS github_extension_tokens (
    token_id SERIAL PRIMARY KEY,
    user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX unique_github_extension_token ON github_extension_tokens(refresh_token);
CREATE INDEX idx_github_extension_tokens_user_email ON github_extension_tokens(user_email);
CREATE INDEX idx_github_extension_tokens_expires_at ON github_extension_tokens(expires_at);

-- 20. GitHub 핸드오프 코드 테이블 (앱 → VSCode 확장 1회용 코드, TTL 60초)
-- 토큰을 vscode:// URI 에 싣지 않기 위한 우회 경로다 (§3.4).
-- 소비는 UPDATE ... WHERE consumed_at IS NULL 로 원자적이라 동시 요청 중 하나만 성공한다.
CREATE TABLE IF NOT EXISTS github_handoff_codes (
    code_id SERIAL PRIMARY KEY,
    code VARCHAR(128) NOT NULL,
    user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    repo_id INTEGER NOT NULL REFERENCES github_repositories(repo_id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX unique_github_handoff_code ON github_handoff_codes(code);
CREATE INDEX idx_github_handoff_codes_expires_at ON github_handoff_codes(expires_at);
CREATE INDEX idx_github_handoff_codes_user_email ON github_handoff_codes(user_email);

-- 21. 채팅 채널 테이블 (워크스페이스 토픽 채널 & 1:1 DM 통합)
CREATE TABLE IF NOT EXISTS chat_channels (
    channel_id SERIAL PRIMARY KEY,
    channel_type VARCHAR(20) NOT NULL CHECK (channel_type IN ('WORKSPACE', 'DM')),
    owner_node_id INTEGER REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    name VARCHAR(100),                     -- WORKSPACE 채널명 (예: '일반', '공지'), DM은 NULL 가능
    description TEXT,                      -- 채널 설명/주제
    is_default BOOLEAN NOT NULL DEFAULT FALSE, -- 워크스페이스 기본 '#일반' 채널 여부
    dm_user1_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE, -- DM 참여자 1 (사전순 작은 user_id)
    dm_user2_id VARCHAR(50) REFERENCES users(user_id) ON DELETE CASCADE, -- DM 참여자 2 (사전순 큰 user_id)
    created_by_user_id VARCHAR(50) REFERENCES users(user_id) ON DELETE SET NULL,
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_channel_type_fields CHECK (
        (channel_type = 'WORKSPACE' AND owner_node_id IS NOT NULL AND name IS NOT NULL)
        OR
        (channel_type = 'DM' AND owner_node_id IS NULL AND dm_user1_id IS NOT NULL AND dm_user2_id IS NOT NULL)
    )
);

-- 같은 워크스페이스 내 동일한 채널명 중복 방지 (소프트 삭제 제외)
CREATE UNIQUE INDEX IF NOT EXISTS unique_workspace_channel_name
    ON chat_channels(owner_node_id, lower(name))
    WHERE channel_type = 'WORKSPACE' AND NOT is_deleted;

-- 두 유저 간 1:1 DM 채널 중복 생성 방지 (LEAST/GREATEST 정규화 저장)
CREATE UNIQUE INDEX IF NOT EXISTS unique_dm_user_pair
    ON chat_channels(dm_user1_id, dm_user2_id)
    WHERE channel_type = 'DM' AND NOT is_deleted;

CREATE INDEX IF NOT EXISTS idx_chat_channels_node_id ON chat_channels(owner_node_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_channels_default_node ON chat_channels(owner_node_id) WHERE channel_type = 'WORKSPACE' AND is_default AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_channels_dm_user1 ON chat_channels(dm_user1_id) WHERE channel_type = 'DM' AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_channels_dm_user2 ON chat_channels(dm_user2_id) WHERE channel_type = 'DM' AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_channels_last_message_at ON chat_channels(last_message_at DESC);

-- 22. 채팅 메시지 테이블 (일반 메시지 및 1-depth 스레드 답글)
CREATE TABLE IF NOT EXISTS chat_messages (
    message_id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(channel_id) ON DELETE CASCADE,
    parent_message_id INTEGER REFERENCES chat_messages(message_id) ON DELETE CASCADE, -- NULL이면 메인 피드 메시지, 값이 있으면 스레드 답글
    sender_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    is_edited BOOLEAN NOT NULL DEFAULT FALSE,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_main ON chat_messages(channel_id, message_id DESC) WHERE parent_message_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_live_main ON chat_messages(channel_id, message_id DESC) WHERE parent_message_id IS NULL AND NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent_thread ON chat_messages(parent_message_id, message_id ASC) WHERE parent_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_user_id);

-- 23. 채팅 메시지 첨부파일 테이블
CREATE TABLE IF NOT EXISTS chat_message_files (
    file_id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
    channel_id INTEGER NOT NULL REFERENCES chat_channels(channel_id) ON DELETE CASCADE,
    uploader_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    original_file_name VARCHAR(255) NOT NULL,
    stored_file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_files_message_id ON chat_message_files(message_id) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_chat_files_channel_id ON chat_message_files(channel_id) WHERE NOT is_deleted;

-- 24. 채널별 사용자 읽음 상태(Unread 계산용) 테이블
CREATE TABLE IF NOT EXISTS chat_channel_reads (
    channel_id INTEGER NOT NULL REFERENCES chat_channels(channel_id) ON DELETE CASCADE,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    last_read_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_reads_user_id ON chat_channel_reads(user_id);

