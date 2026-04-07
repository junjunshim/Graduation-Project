-- 1) update_at을 갱신해주는 공용 함수 생성
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2) 각 테이블에 트리거 적용
CREATE TRIGGER trg_update_nodes_time BEFORE UPDATE ON organization_nodes FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_users_time BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_roles_time BEFORE UPDATE ON role_assignments FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_workitems_time BEFORE UPDATE ON work_items FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER trg_update_tokens_time BEFORE UPDATE ON user_refresh_tokens FOR EACH ROW EXECUTE FUNCTION update_modified_column();