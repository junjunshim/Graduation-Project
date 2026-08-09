-- 1. users 히스토리 함수
CREATE OR REPLACE FUNCTION log_users_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO user_histories (user_id, email, name, password_hash, personal_node_id, created_at, updated_at, change_status)
        VALUES (OLD.user_id, OLD.email, OLD.name, OLD.password_hash, OLD.personal_node_id, OLD.created_at, OLD.updated_at, 'deleted');
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO user_histories (user_id, email, name, password_hash, personal_node_id, created_at, updated_at, change_status)
        VALUES (NEW.user_id, NEW.email, NEW.name, NEW.password_hash, NEW.personal_node_id, NEW.created_at, NEW.updated_at, 'updated');
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO user_histories (user_id, email, name, password_hash, personal_node_id, created_at, updated_at, change_status)
        VALUES (NEW.user_id, NEW.email, NEW.name, NEW.password_hash, NEW.personal_node_id, NEW.created_at, NEW.updated_at, 'inserted');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- 2. organization_nodes 히스토리 함수
CREATE OR REPLACE FUNCTION log_organization_nodes_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO organization_node_histories (node_id, node_type, parent_node_id, name, path, is_deleted, created_at, updated_at, change_status)
        VALUES (OLD.node_id, OLD.node_type, OLD.parent_node_id, OLD.name, OLD.path, OLD.is_deleted, OLD.created_at, OLD.updated_at, 'deleted');
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO organization_node_histories (node_id, node_type, parent_node_id, name, path, is_deleted, created_at, updated_at, change_status)
        VALUES (NEW.node_id, NEW.node_type, NEW.parent_node_id, NEW.name, NEW.path, NEW.is_deleted, NEW.created_at, NEW.updated_at, 'updated');
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO organization_node_histories (node_id, node_type, parent_node_id, name, path, is_deleted, created_at, updated_at, change_status)
        VALUES (NEW.node_id, NEW.node_type, NEW.parent_node_id, NEW.name, NEW.path, NEW.is_deleted, NEW.created_at, NEW.updated_at, 'inserted');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- 3. role_assignments 히스토리 함수
CREATE OR REPLACE FUNCTION log_role_assignments_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO role_assignment_histories (assignment_id, user_id, node_id, role, created_at, updated_at, change_status)
        VALUES (OLD.assignment_id, OLD.user_id, OLD.node_id, OLD.role, OLD.created_at, OLD.updated_at, 'deleted');
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO role_assignment_histories (assignment_id, user_id, node_id, role, created_at, updated_at, change_status)
        VALUES (NEW.assignment_id, NEW.user_id, NEW.node_id, NEW.role, NEW.created_at, NEW.updated_at, 'updated');
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO role_assignment_histories (assignment_id, user_id, node_id, role, created_at, updated_at, change_status)
        VALUES (NEW.assignment_id, NEW.user_id, NEW.node_id, NEW.role, NEW.created_at, NEW.updated_at, 'inserted');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- 4. role_authorities 히스토리 함수
CREATE OR REPLACE FUNCTION log_role_authorities_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO role_authority_histories (authority_id, node_id, role, authority, created_at, updated_at, change_status)
        VALUES (OLD.authority_id, OLD.node_id, OLD.role, OLD.authority, OLD.created_at, OLD.updated_at, 'deleted');
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO role_authority_histories (authority_id, node_id, role, authority, created_at, updated_at, change_status)
        VALUES (NEW.authority_id, NEW.node_id, NEW.role, NEW.authority, NEW.created_at, NEW.updated_at, 'updated');
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO role_authority_histories (authority_id, node_id, role, authority, created_at, updated_at, change_status)
        VALUES (NEW.authority_id, NEW.node_id, NEW.role, NEW.authority, NEW.created_at, NEW.updated_at, 'inserted');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- 5. work_items 히스토리 함수
CREATE OR REPLACE FUNCTION log_work_items_history()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        INSERT INTO work_item_histories (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description, hidden, status, priority, weight, progress, is_deleted, start_date, due_date, created_at, updated_at, change_status)
        VALUES (OLD.work_item_id, OLD.owner_node_id, OLD.parent_work_item_id, OLD.owner_user_id, OLD.title, OLD.description, OLD.hidden, OLD.status, OLD.priority, OLD.weight, OLD.progress, OLD.is_deleted, OLD.start_date, OLD.due_date, OLD.created_at, OLD.updated_at, 'deleted');
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO work_item_histories (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description, hidden, status, priority, weight, progress, is_deleted, start_date, due_date, created_at, updated_at, change_status)
        VALUES (NEW.work_item_id, NEW.owner_node_id, NEW.parent_work_item_id, NEW.owner_user_id, NEW.title, NEW.description, NEW.hidden, NEW.status, NEW.priority, NEW.weight, NEW.progress, NEW.is_deleted, NEW.start_date, NEW.due_date, NEW.created_at, NEW.updated_at, 'updated');
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO work_item_histories (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description, hidden, status, priority, weight, progress, is_deleted, start_date, due_date, created_at, updated_at, change_status)
        VALUES (NEW.work_item_id, NEW.owner_node_id, NEW.parent_work_item_id, NEW.owner_user_id, NEW.title, NEW.description, NEW.hidden, NEW.status, NEW.priority, NEW.weight, NEW.progress, NEW.is_deleted, NEW.start_date, NEW.due_date, NEW.created_at, NEW.updated_at, 'inserted');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;