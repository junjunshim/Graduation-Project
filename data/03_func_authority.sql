-- Function: default_node_authority (노드 기본 권한 설정 함수)
CREATE OR REPLACE FUNCTION default_node_authority(
    p_node_id organization_nodes.node_id%TYPE
) RETURNS VOID AS $$
BEGIN
    -- 노드 생성 시, 해당 노드에 대한 기본 권한 설정 (role_defaults 테이블에서 가져옴)
    INSERT INTO role_authorities (node_id, role, authority)
    SELECT p_node_id, role, default_authority
    FROM role_defaults;
END;
$$ LANGUAGE plpgsql;


-- Function: check_authority_with_override (유저 권한 체크 함수)
CREATE OR REPLACE FUNCTION check_authority_with_override(
    p_user_id users.user_id%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_required_authority_name authority_constants.name%TYPE
) RETURNS BOOLEAN AS $$
DECLARE
    v_path organization_nodes.path%TYPE;
    v_final_auth BIT(24);
    v_required_bit BIT(24);
    V_deny_bit BIT(24);
BEGIN
    -- 0단계: 권한 이름을 비트마스크로 변환
    SELECT (B'000000000000000000000001'::BIT(24) << bit_position)
    INTO v_required_bit
    FROM authority_constants
    WHERE name = p_required_authority_name;

    IF v_required_bit IS NULL THEN
        RAISE EXCEPTION '[P0007]Invalid authority name: %', p_required_authority_name
        USING ERRCODE = 'P0007';
    END IF;

    -- 1단계: 현재 노드(p_node_id)에 직접 설정된 권한 확인
    SELECT BIT_OR(auth.authority) INTO v_final_auth
    FROM role_assignments ra
    JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
    WHERE ra.user_id = p_user_id AND ra.node_id = p_node_id;

    -- 2단계: 설정이 없을 경우, 부모 노드를 아래(가까운 쪽)부터 위로 탐색
    v_path := (SELECT path FROM organization_nodes WHERE node_id = p_node_id);
    IF v_final_auth IS NULL THEN
        SELECT auth.authority INTO v_final_auth
        FROM (
            -- WITH ORDINALITY는 배열의 원래 순서(index)를 함께 반환합니다.
            SELECT elem_id, idx
            FROM unnest(v_path) 
                 WITH ORDINALITY AS t(elem_id, idx)
            WHERE elem_id != p_node_id
            ORDER BY idx DESC  -- 인덱스가 큰 것(가까운 부모)부터 정렬
        ) AS sorted_path
        JOIN role_assignments ra ON ra.node_id = sorted_path.elem_id
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
        WHERE ra.user_id = p_user_id
        -- 특정 부모 노드에 여러 역할이 있을 수 있으므로 BIT_OR 후 하나만 선택
        GROUP BY sorted_path.idx, auth.authority
        ORDER BY sorted_path.idx DESC
        LIMIT 1;
    END IF;

    -- 3단계: DENY 비트(bit 23)가 켜져 있으면 무조건 거부
    -- 24비트에서 가장 왼쪽 비트 (23번 비트)
    SELECT (B'000000000000000000000001'::BIT(24) << bit_position)
    INTO v_deny_bit
    FROM authority_constants
    WHERE name = 'DENY';

    IF (v_final_auth & v_deny_bit) = v_deny_bit THEN
        RETURN FALSE;
    END IF;

    -- 4단계: 최종 권한 체크
    IF v_final_auth IS NULL THEN 
        RETURN FALSE; 
    END IF;
    
    RETURN (v_final_auth & v_required_bit) = v_required_bit;

    EXCEPTION
        WHEN SQLSTATE 'P0007' THEN
        RAISE;
        WHEN OTHERS THEN
        RAISE EXCEPTION '[P0008]Error checking authority: (REASON : %)', SQLERRM
        USING ERRCODE = 'P0008';
END;
$$ LANGUAGE plpgsql;
