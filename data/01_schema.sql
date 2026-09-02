-- 0. enum 타입 정의
DROP TYPE IF EXISTS history_status CASCADE;
CREATE TYPE history_status AS ENUM ('inserted', 'updated', 'deleted');


-- 1. organization_nodes - 모든 공간과 주체의 트리 구조 
CREATE TABLE IF NOT EXISTS organization_nodes (
    node_id SERIAL PRIMARY KEY,
    node_type VARCHAR(20) NOT NULL,
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


-- 3. 유저와 노드 간이 권한 매핑
CREATE TABLE IF NOT EXISTS role_assignments (
    assignment_id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_assignments UNIQUE (user_id, node_id, role)
);
CREATE INDEX idx_assignments_user_id ON role_assignments(user_id);
CREATE INDEX idx_assignments_node_id ON role_assignments(node_id);


-- 4. 노드의 각 권한의 범위
CREATE TABLE IF NOT EXISTS role_authorities (
    authority_id SERIAL PRIMARY KEY,
    node_id INTEGER NOT NULL REFERENCES organization_nodes(node_id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    authority BIT(24) NOT NULL, -- Bitmask 권한 (8 -> 24)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_authorities UNIQUE (node_id, role)
);
CREATE INDEX idx_authorities_node_id ON role_authorities(node_id);

-- 4.1 권한 상수 테이블 (하드코딩 방지)
CREATE TABLE IF NOT EXISTS authority_constants (
    constant_id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    bit_position INTEGER NOT NULL CHECK (bit_position BETWEEN 0 AND 23),
    description TEXT
);

-- 4.2 역할별 기본 권한 테이블
CREATE TABLE IF NOT EXISTS role_defaults (
    role VARCHAR(50) PRIMARY KEY,
    default_authority BIT(24) NOT NULL
);

-- 5. 업무와 프로젝트 데이터
CREATE TABLE IF NOT EXISTS work_items (
    work_item_id VARCHAR(50) PRIMARY KEY,
    owner_node_id INTEGER REFERENCES organization_nodes(node_id) ON DELETE SET NULL,
    parent_work_item_id VARCHAR(50) REFERENCES work_items(work_item_id) ON DELETE SET NULL,
    owner_user_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    hidden BOOLEAN NOT NULL DEFAULT FALSE,
    status  VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
    progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    start_date DATE,
    due_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_dates CHECK (due_date >= start_date)
);
CREATE INDEX idx_work_items_node_id ON work_items(owner_node_id);
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
    node_type VARCHAR(20) NOT NULL,
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
    history_id SERIAL PRIMARY KEY,
    authority_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    role VARCHAR(50) NOT NULL,
    authority BIT(24) NOT NULL,
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

