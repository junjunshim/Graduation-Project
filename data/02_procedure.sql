-- 컨트롤러에서 사용될 프로시저 생성

-- 1. OrgController::createNode
CREATE OR REPLACE FUNCTION create_top_node(
    p_node_type VARCHAR,
    p_name VARCHAR,
    p_user_id VARCHAR,
    p_role_name VARCHAR DEFAULT 'ADMIN'
) RETURNS INTEGER AS $$
DECLARE
    v_new_node_id INTEGER;
BEGIN
    -- 1. 노드 생성 (nextval과 path 처리)
    INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
    VALUES (
        nextval('organization_nodes_node_id_seq'),
        p_node_type,
        NULL,
        p_name,
        ARRAY[currval('organization_nodes_node_id_seq')]
    )
    RETURNING node_id INTO v_new_node_id;

    -- 2. 역할 배정 (role_assignments 테이블)
    INSERT INTO role_assignments (user_id, node_id, role)
    VALUES (p_user_id, v_new_node_id, p_role_name);

    -- 생성된 노드 ID 반환
    RETURN v_new_node_id;
END;
$$ LANGUAGE plpgsql;
