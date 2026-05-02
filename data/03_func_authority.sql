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

-- Function: get_bit_position (권한 이름을 비트 위치로 변환하는 함수)
CREATE OR REPLACE FUNCTION get_bit_position(
    p_authority_name authority_constants.name%TYPE
) RETURNS BIT(24) AS $$
DECLARE
    v_required_bit BIT(24);
BEGIN
    SELECT (B'000000000000000000000001'::BIT(24) << bit_position)
    INTO v_required_bit
    FROM authority_constants
    WHERE name = p_authority_name;

    IF v_required_bit IS NULL THEN
        RAISE EXCEPTION '[P0007]Invalid authority name: %', p_authority_name
        USING ERRCODE = 'P0007';
    END IF;

    RETURN v_required_bit;
END;
$$ LANGUAGE plpgsql;

-- Function: get_effective_authority (유저의 최종 권한 비트마스크 계산 함수)
CREATE OR REPLACE FUNCTION get_effective_authority(
    p_user_id users.user_id%TYPE,
    p_node_id organization_nodes.node_id%TYPE
) RETURNS BIT(24) AS $$
DECLARE
    v_path organization_nodes.path%TYPE;
    v_final_auth BIT(24);
BEGIN
    -- 1단계: 현재 노드(p_node_id)에 직접 설정된 권한 확인 (여러 역할 합산)
    SELECT BIT_OR(auth.authority) INTO v_final_auth
    FROM role_assignments ra
    JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
    WHERE ra.user_id = p_user_id AND ra.node_id = p_node_id;

    -- 2단계: 설정이 없을 경우, 부모 노드를 아래(가까운 쪽)부터 위로 탐색
    IF v_final_auth IS NULL THEN
        SELECT path INTO v_path FROM organization_nodes WHERE node_id = p_node_id;
        
        SELECT BIT_OR(auth.authority) INTO v_final_auth
        FROM (
            SELECT elem_id, idx
            FROM unnest(v_path) WITH ORDINALITY AS t(elem_id, idx)
            WHERE elem_id != p_node_id
            ORDER BY idx DESC
        ) AS sorted_path
        JOIN role_assignments ra ON ra.node_id = sorted_path.elem_id
        JOIN role_authorities auth ON ra.node_id = auth.node_id AND ra.role = auth.role
        WHERE ra.user_id = p_user_id
        GROUP BY sorted_path.idx
        ORDER BY sorted_path.idx DESC
        LIMIT 1;
    END IF;

    RETURN v_final_auth;
END;
$$ LANGUAGE plpgsql;

-- Function: check_authority_with_override (유저 권한 체크 함수)
CREATE OR REPLACE FUNCTION check_authority_with_override(
    p_user_id users.user_id%TYPE,
    p_node_id organization_nodes.node_id%TYPE,
    p_required_authority_name authority_constants.name%TYPE
) RETURNS BOOLEAN AS $$
DECLARE
    v_final_auth BIT(24);
    v_required_bit BIT(24);
    v_deny_bit BIT(24);
BEGIN
    -- 0단계: 권한 비트 로드 (필요 권한 및 DENY 권한을 한 번의 쿼리로 가져옴)
    SELECT 
        BIT_OR(CASE WHEN name = p_required_authority_name THEN (B'000000000000000000000001'::BIT(24) << bit_position) END),
        BIT_OR(CASE WHEN name = 'DENY' THEN (B'000000000000000000000001'::BIT(24) << bit_position) END)
    INTO v_required_bit, v_deny_bit
    FROM authority_constants
    WHERE name IN (p_required_authority_name, 'DENY');

    IF v_required_bit IS NULL THEN
        RAISE EXCEPTION '[P0007]Invalid authority name: %', p_required_authority_name
        USING ERRCODE = 'P0007';
    END IF;

    -- 1단계: 유효 권한 가져오기 (Override 정책 적용)
    v_final_auth := get_effective_authority(p_user_id, p_node_id);

    -- 2단계: DENY 비트(bit 23)가 켜져 있으면 무조건 거부
    IF (v_final_auth & v_deny_bit) = v_deny_bit THEN
        RETURN FALSE;
    END IF;

    -- 3단계: 최종 권한 체크
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
