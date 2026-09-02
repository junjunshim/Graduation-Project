-- 1. update_at을 갱신해주는 공용 함수 생성
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;



-- 2. update_modified_column 함수를 각 테이블의 BEFORE UPDATE 트리거로 설정
DROP TRIGGER IF EXISTS trg_update_nodes_time ON organization_nodes;
DROP TRIGGER IF EXISTS trg_update_users_time ON users;
DROP TRIGGER IF EXISTS trg_update_assignments_time ON role_assignments;
DROP TRIGGER IF EXISTS trg_update_authorities_time ON role_authorities;
DROP TRIGGER IF EXISTS trg_update_workitems_time ON work_items;
DROP TRIGGER IF EXISTS trg_update_tokens_time ON user_refresh_tokens;
DROP TRIGGER IF EXISTS trg_update_comments_time ON work_item_comments;
DROP TRIGGER IF EXISTS trg_update_mentions_time ON comment_mentions;
DROP TRIGGER IF EXISTS trg_update_files_time ON work_item_files;

CREATE TRIGGER trg_update_nodes_time BEFORE UPDATE ON organization_nodes FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_users_time BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_assignments_time BEFORE UPDATE ON role_assignments FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_authorities_time BEFORE UPDATE ON role_authorities FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_workitems_time BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_tokens_time BEFORE UPDATE ON user_refresh_tokens FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_comments_time BEFORE UPDATE ON work_item_comments FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_mentions_time BEFORE UPDATE ON comment_mentions FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_files_time BEFORE UPDATE ON work_item_files FOR EACH ROW EXECUTE FUNCTION update_modified_column();


-- 3. 히스토리 테이블에 등록하는 함수를 각 테이블의 AFTER 트리거로 설정
DROP TRIGGER IF EXISTS trg_history_users ON users;
DROP TRIGGER IF EXISTS trg_history_organization_nodes ON organization_nodes;
DROP TRIGGER IF EXISTS trg_history_role_assignments ON role_assignments;
DROP TRIGGER IF EXISTS trg_history_role_authorities ON role_authorities;
DROP TRIGGER IF EXISTS trg_history_work_items ON work_items;

CREATE TRIGGER trg_history_users
AFTER INSERT OR UPDATE OR DELETE ON users
FOR EACH ROW EXECUTE FUNCTION log_users_history();

CREATE TRIGGER trg_history_organization_nodes
AFTER INSERT OR UPDATE OR DELETE ON organization_nodes
FOR EACH ROW EXECUTE FUNCTION log_organization_nodes_history();

CREATE TRIGGER trg_history_role_assignments
AFTER INSERT OR UPDATE OR DELETE ON role_assignments
FOR EACH ROW EXECUTE FUNCTION log_role_assignments_history();

CREATE TRIGGER trg_history_role_authorities
AFTER INSERT OR UPDATE OR DELETE ON role_authorities
FOR EACH ROW EXECUTE FUNCTION log_role_authorities_history();

CREATE TRIGGER trg_history_work_items
AFTER INSERT OR UPDATE OR DELETE ON work_items
FOR EACH ROW EXECUTE FUNCTION log_work_items_history();


-- 4. work_items 소프트 딜리트 연쇄(Cascade) 트리거 정의
CREATE OR REPLACE FUNCTION handle_work_item_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- 1) 소프트 딜리트 연쇄 반응 (is_deleted: FALSE -> TRUE)
    IF NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
        -- 하위 하위 업무들 연쇄 소프트 딜리트
        UPDATE work_items
        SET is_deleted = TRUE
        WHERE parent_work_item_id = NEW.work_item_id
          AND is_deleted = FALSE;

        -- 소속 첨부파일들 연쇄 소프트 딜리트
        UPDATE work_item_files
        SET is_deleted = TRUE
        WHERE work_item_id = NEW.work_item_id
          AND is_deleted = FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_item_soft_delete ON work_items;
CREATE TRIGGER trg_work_item_soft_delete
AFTER UPDATE OF is_deleted ON work_items
FOR EACH ROW EXECUTE FUNCTION handle_work_item_soft_delete();


-- 5. organization_nodes 소프트 딜리트 연쇄(Cascade) 트리거 정의
CREATE OR REPLACE FUNCTION handle_node_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- 1) 소프트 딜리트 연쇄 반응 (is_deleted: FALSE -> TRUE)
    IF NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
        -- 소속 업무들 연쇄 소프트 딜리트 (업무 트리거가 파일까지 연쇄 딜리트 처리)
        UPDATE work_items
        SET is_deleted = TRUE
        WHERE owner_node_id = NEW.node_id
          AND is_deleted = FALSE;

        -- 하위 자식 노드들 연쇄 소프트 딜리트
        UPDATE organization_nodes
        SET is_deleted = TRUE
        WHERE parent_node_id = NEW.node_id
          AND is_deleted = FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_node_soft_delete ON organization_nodes;
CREATE TRIGGER trg_node_soft_delete
AFTER UPDATE OF is_deleted ON organization_nodes
FOR EACH ROW EXECUTE FUNCTION handle_node_soft_delete();


-- 6. users 소프트 딜리트 연쇄(Cascade) 트리거 정의
CREATE OR REPLACE FUNCTION handle_user_soft_delete()
RETURNS TRIGGER AS $$
BEGIN
    -- 1) 소프트 딜리트 연쇄 반응 (is_deleted: FALSE -> TRUE)
    IF NEW.is_deleted = TRUE AND OLD.is_deleted = FALSE THEN
        -- 유저의 개인 전용 공간 노드 소프트 딜리트 (개인 노드 내 업무들은 노드 트리거에 의해 연쇄 딜리트됨)
        IF NEW.personal_node_id IS NOT NULL THEN
            UPDATE organization_nodes
            SET is_deleted = TRUE
            WHERE node_id = NEW.personal_node_id
              AND is_deleted = FALSE;
        END IF;

        -- 탈퇴 유저가 담당하던 모든 업무들 소프트 딜리트
        UPDATE work_items
        SET is_deleted = TRUE
        WHERE owner_user_id = NEW.user_id
          AND is_deleted = FALSE;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_soft_delete ON users;
CREATE TRIGGER trg_user_soft_delete
AFTER UPDATE OF is_deleted ON users
FOR EACH ROW EXECUTE FUNCTION handle_user_soft_delete();