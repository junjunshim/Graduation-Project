-- Definition flags are copied only to enforce a concurrent-safe partial unique index.
-- The composite FK prevents callers from falsifying the copied flag.
CREATE OR REPLACE FUNCTION prepare_role_assignment() RETURNS TRIGGER AS $$
BEGIN
    SELECT is_top_role INTO NEW.is_top_role FROM role_authorities
    WHERE authority_id = NEW.role_id AND node_id = NEW.node_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION '[P0407]Role does not belong to this node' USING ERRCODE = 'P0407';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_prepare_role_assignment ON role_assignments;
CREATE TRIGGER trg_prepare_role_assignment BEFORE INSERT OR UPDATE ON role_assignments
FOR EACH ROW EXECUTE FUNCTION prepare_role_assignment();

CREATE OR REPLACE FUNCTION protect_top_role() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_top_role IS DISTINCT FROM OLD.is_top_role
       OR (OLD.is_top_role AND NEW.authority IS DISTINCT FROM OLD.authority) THEN
        RAISE EXCEPTION '[P0409]Cannot change top role properties' USING ERRCODE = 'P0409';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_protect_top_role ON role_authorities;
CREATE TRIGGER trg_protect_top_role BEFORE UPDATE ON role_authorities
FOR EACH ROW EXECUTE FUNCTION protect_top_role();

CREATE OR REPLACE FUNCTION check_node_top_assignee(p_node_id INTEGER) RETURNS VOID AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM organization_nodes WHERE node_id = p_node_id AND NOT is_deleted) THEN
        IF (SELECT COUNT(*) FROM role_authorities WHERE node_id = p_node_id AND is_top_role) <> 1
           OR (SELECT COUNT(*) FROM role_assignments r JOIN users u ON u.user_id = r.user_id
               WHERE r.node_id = p_node_id AND r.is_top_role AND NOT u.is_deleted) <> 1 THEN
            RAISE EXCEPTION '[P0409]An active node must have exactly one top assignee: %', p_node_id
                USING ERRCODE = 'P0409';
        END IF;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_top_assignee_integrity() RETURNS TRIGGER AS $$
DECLARE v_node_id INTEGER;
BEGIN
    IF TG_TABLE_NAME = 'users' THEN
        FOR v_node_id IN SELECT node_id FROM role_assignments WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) AND is_top_role LOOP
            PERFORM check_node_top_assignee(v_node_id);
        END LOOP;
    ELSE
        IF TG_OP <> 'INSERT' THEN PERFORM check_node_top_assignee(OLD.node_id); END IF;
        IF TG_OP <> 'DELETE' THEN PERFORM check_node_top_assignee(NEW.node_id); END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_check_top_assignee ON role_assignments;
CREATE CONSTRAINT TRIGGER trg_check_top_assignee AFTER INSERT OR UPDATE OR DELETE ON role_assignments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_top_assignee_integrity();
DROP TRIGGER IF EXISTS trg_check_top_definition ON role_authorities;
CREATE CONSTRAINT TRIGGER trg_check_top_definition AFTER INSERT OR UPDATE OR DELETE ON role_authorities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_top_assignee_integrity();
DROP TRIGGER IF EXISTS trg_check_node_owner ON organization_nodes;
CREATE CONSTRAINT TRIGGER trg_check_node_owner AFTER INSERT OR UPDATE ON organization_nodes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_top_assignee_integrity();
DROP TRIGGER IF EXISTS trg_check_user_ownership ON users;
CREATE CONSTRAINT TRIGGER trg_check_user_ownership AFTER UPDATE OR DELETE ON users
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_top_assignee_integrity();
