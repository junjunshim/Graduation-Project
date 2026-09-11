-- =========================================================================
-- 삼성 단일 그룹 계열사 기반 대규모 통합 계층 트리 시드 데이터 생성
-- 최상위: 삼성 (COMPANY) -> 계열사 (DIVISION, 6개) -> 본부 (DIVISION, 4개) -> 부서 (DEPARTMENT, 5개) -> 팀 (TEAM, 3개)
-- 
-- 권한 체계:
-- 1. 최상위 '삼성' 노드: 삼성 관리자(samsung_admin@samsung.com) 단 1명만 소속 (ADMIN)
-- 2. 각 계열사: 삼성 관리자가 계열사 노드를 생성(ADMIN)하고, 계열사 사장을 해당 노드의 MANAGER로 배정
-- 3. 각 본부: 계열사 사장이 본부 노드를 생성(ADMIN)하고, 본부장을 해당 노드의 MANAGER로 배정
-- 4. 각 부서: 본부장이 부서 노드를 생성(ADMIN)하고, 부서장을 해당 노드의 MANAGER로 배정
-- 5. 각 팀: 부서장이 팀 노드를 생성(ADMIN)하고, 팀장을 해당 노드의 MANAGER로 배정
-- =========================================================================

DO $$
DECLARE
    -- 공통 비밀번호 해시 ('samsung@1234') 사전 계산 (성능 최적화)
    v_default_password_hash TEXT;

    -- 6대 계열사 정의
    v_affiliates VARCHAR[] := ARRAY['삼성전자', '삼성생명', '삼성물산', '호텔신라', '에스원', '삼성전기'];
    v_aff_codes VARCHAR[] := ARRAY['sec', 'samsunglife', 'samsungcnt', 'shilla', 's1', 'sem'];

    -- 본부 (4개) 정의
    v_divisions VARCHAR[] := ARRAY['경영지원본부', '사업본부', '기술본부', '전략기획본부'];

    -- 부서 (5개) 정의
    v_depts VARCHAR[] := ARRAY['인사부', '기획부', '개발부', '영업부', '재무부'];

    -- 루프 인덱스 변수
    a_idx INT;
    div_idx INT;
    dept_idx INT;
    team_idx INT;

    -- 카운터 (고유 ID 생성)
    v_user_counter INT := 100;

    -- 1. 삼성 총괄 관리자 계정 변수
    v_samsung_admin_id VARCHAR;
    v_samsung_admin_email VARCHAR := 'samsung_admin@samsung.com';
    v_samsung_admin_name VARCHAR := '삼성 계정 관리자';

    -- 2. 계열사 사장 계정 변수
    v_aff_ceo_id VARCHAR;
    v_aff_ceo_email VARCHAR;
    v_aff_ceo_name VARCHAR;

    -- 3. 본부장 계정 변수
    v_div_leader_id VARCHAR;
    v_div_leader_email VARCHAR;
    v_div_leader_name VARCHAR;

    -- 4. 부서장 계정 변수
    v_dept_leader_id VARCHAR;
    v_dept_leader_email VARCHAR;
    v_dept_leader_name VARCHAR;

    -- 5. 팀장 계정 변수
    v_team_leader_id VARCHAR;
    v_team_leader_email VARCHAR;
    v_team_leader_name VARCHAR;

    -- 노드 ID 변수
    v_samsung_node_id INT;
    v_aff_node_id INT;
    v_div_node_id INT;
    v_dept_node_id INT;
    v_team_node_id INT;

    -- 역할 ID 변수
    v_manager_role_id INT;
    v_member_role_id INT;
    v_viewer_role_id INT;

BEGIN
    RAISE NOTICE 'Starting seed generation for Samsung Enterprise Group...';

    -- 공통 비밀번호 단방향 Bcrypt 해시 사전 생성 ('samsung@1234')
    v_default_password_hash := crypt('samsung@1234', gen_salt('bf', 10));

    -- =====================================================================
    -- 1. 최상위 '삼성' 총괄 관리자 계정 생성 및 최상위 노드 생성
    -- =====================================================================
    v_samsung_admin_id := 'U-' || v_user_counter;
    v_user_counter := v_user_counter + 1;

    PERFORM register_user(
        v_samsung_admin_id,
        v_samsung_admin_email,
        v_samsung_admin_name,
        v_default_password_hash
    );

    PERFORM create_top_node(v_samsung_admin_email, 'COMPANY', '삼성');

    SELECT MAX(node_id) INTO v_samsung_node_id
    FROM organization_nodes
    WHERE node_type = 'COMPANY' AND name = '삼성' AND is_deleted = FALSE;

    RAISE NOTICE 'Created top node: 삼성 (node_id: %)', v_samsung_node_id;

    -- 1-2. 최상위 삼성 노드 실무 구성원 배정 (준법감시관 VIEWER, 비서실장 MEMBER)
    SELECT authority_id INTO v_viewer_role_id FROM role_authorities WHERE node_id = v_samsung_node_id AND role = 'VIEWER';
    SELECT authority_id INTO v_member_role_id FROM role_authorities WHERE node_id = v_samsung_node_id AND role = 'MEMBER';

    PERFORM register_user('U-' || v_user_counter, 'samsung_audit@samsung.com', '삼성 준법감시관', v_default_password_hash);
    PERFORM add_role(v_samsung_admin_email, 'samsung_audit@samsung.com', v_samsung_node_id, v_viewer_role_id);
    v_user_counter := v_user_counter + 1;

    PERFORM register_user('U-' || v_user_counter, 'samsung_sec@samsung.com', '삼성 비서실장', v_default_password_hash);
    PERFORM add_role(v_samsung_admin_email, 'samsung_sec@samsung.com', v_samsung_node_id, v_member_role_id);
    v_user_counter := v_user_counter + 1;

    -- =====================================================================
    -- 2. 6대 계열사 생성 루프
    -- =====================================================================
    FOR a_idx IN 1..6 LOOP
        -- 2-1. 계열사 사장 계정 생성
        v_aff_ceo_id := 'U-' || v_user_counter;
        v_user_counter := v_user_counter + 1;
        v_aff_ceo_email := v_aff_codes[a_idx] || '_ceo@samsung.com';
        v_aff_ceo_name := v_affiliates[a_idx] || ' 사장';

        PERFORM register_user(
            v_aff_ceo_id,
            v_aff_ceo_email,
            v_aff_ceo_name,
            v_default_password_hash
        );

        -- 2-2. 삼성 관리자가 계열사 노드 생성 (ADMIN: 삼성 관리자)
        PERFORM create_sub_node(
            v_samsung_admin_email,
            'DIVISION',
            v_samsung_node_id,
            v_affiliates[a_idx],
            v_samsung_admin_email
        );

        SELECT MAX(node_id) INTO v_aff_node_id
        FROM organization_nodes
        WHERE node_type = 'DIVISION' AND name = v_affiliates[a_idx] AND parent_node_id = v_samsung_node_id AND is_deleted = FALSE;

        -- 2-3. 삼성 관리자가 계열사 노드에 계열사 사장을 MANAGER 역할로 등록
        SELECT authority_id INTO v_manager_role_id
        FROM role_authorities
        WHERE node_id = v_aff_node_id AND role = 'MANAGER';

        PERFORM add_role(
            v_samsung_admin_email,
            v_aff_ceo_email,
            v_aff_node_id,
            v_manager_role_id
        );

        -- 2-4. 계열사 직속 지원 실무자 배정 (비서관 MEMBER, 기획조정역 MEMBER)
        SELECT authority_id INTO v_member_role_id FROM role_authorities WHERE node_id = v_aff_node_id AND role = 'MEMBER';

        PERFORM register_user('U-' || v_user_counter, v_aff_codes[a_idx] || '_secretary@samsung.com', v_affiliates[a_idx] || ' 대표 비서관', v_default_password_hash);
        PERFORM add_role(v_samsung_admin_email, v_aff_codes[a_idx] || '_secretary@samsung.com', v_aff_node_id, v_member_role_id);
        v_user_counter := v_user_counter + 1;

        PERFORM register_user('U-' || v_user_counter, v_aff_codes[a_idx] || '_strategy@samsung.com', v_affiliates[a_idx] || ' 기획조정 매니저', v_default_password_hash);
        PERFORM add_role(v_samsung_admin_email, v_aff_codes[a_idx] || '_strategy@samsung.com', v_aff_node_id, v_member_role_id);
        v_user_counter := v_user_counter + 1;

        -- =================================================================
        -- 3. 계열사 산하 4대 본부 생성 루프
        -- =================================================================
        FOR div_idx IN 1..4 LOOP
            -- 3-1. 본부장 계정 생성
            v_div_leader_id := 'U-' || v_user_counter;
            v_user_counter := v_user_counter + 1;
            v_div_leader_email := v_aff_codes[a_idx] || '_div' || div_idx || '_leader@samsung.com';
            v_div_leader_name := v_affiliates[a_idx] || ' ' || v_divisions[div_idx] || ' 본부장';

            PERFORM register_user(
                v_div_leader_id,
                v_div_leader_email,
                v_div_leader_name,
                v_default_password_hash
            );

            -- 3-2. 계열사 사장(MANAGER 권한 보유)이 본부 노드 생성 (ADMIN: 계열사 사장)
            PERFORM create_sub_node(
                v_aff_ceo_email,
                'DIVISION',
                v_aff_node_id,
                v_affiliates[a_idx] || ' ' || v_divisions[div_idx],
                v_aff_ceo_email
            );

            SELECT MAX(node_id) INTO v_div_node_id
            FROM organization_nodes
            WHERE node_type = 'DIVISION' AND name = (v_affiliates[a_idx] || ' ' || v_divisions[div_idx]) AND parent_node_id = v_aff_node_id AND is_deleted = FALSE;

            -- 3-3. 계열사 사장이 본부 노드에 본부장을 MANAGER 역할로 등록
            SELECT authority_id INTO v_manager_role_id
            FROM role_authorities
            WHERE node_id = v_div_node_id AND role = 'MANAGER';

            PERFORM add_role(
                v_aff_ceo_email,
                v_div_leader_email,
                v_div_node_id,
                v_manager_role_id
            );

            -- 3-4. 본부 직속 PMO / 운영간사 배정 (MEMBER)
            SELECT authority_id INTO v_member_role_id FROM role_authorities WHERE node_id = v_div_node_id AND role = 'MEMBER';

            PERFORM register_user('U-' || v_user_counter, v_aff_codes[a_idx] || '_div' || div_idx || '_pmo@samsung.com', v_affiliates[a_idx] || ' ' || v_divisions[div_idx] || ' PMO 매니저', v_default_password_hash);
            PERFORM add_role(v_aff_ceo_email, v_aff_codes[a_idx] || '_div' || div_idx || '_pmo@samsung.com', v_div_node_id, v_member_role_id);
            v_user_counter := v_user_counter + 1;

            -- =============================================================
            -- 4. 본부 산하 5개 부서 생성 루프
            -- =============================================================
            FOR dept_idx IN 1..5 LOOP
                -- 4-1. 부서장 계정 생성
                v_dept_leader_id := 'U-' || v_user_counter;
                v_user_counter := v_user_counter + 1;
                v_dept_leader_email := v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_leader@samsung.com';
                v_dept_leader_name := v_affiliates[a_idx] || ' ' || v_divisions[div_idx] || ' ' || v_depts[dept_idx] || '장';

                PERFORM register_user(
                    v_dept_leader_id,
                    v_dept_leader_email,
                    v_dept_leader_name,
                    v_default_password_hash
                );

                -- 4-2. 본부장이 부서 노드 생성 (ADMIN: 본부장)
                PERFORM create_sub_node(
                    v_div_leader_email,
                    'DEPARTMENT',
                    v_div_node_id,
                    v_affiliates[a_idx] || ' ' || v_divisions[div_idx] || ' ' || v_depts[dept_idx],
                    v_div_leader_email
                );

                SELECT MAX(node_id) INTO v_dept_node_id
                FROM organization_nodes
                WHERE node_type = 'DEPARTMENT' AND name = (v_affiliates[a_idx] || ' ' || v_divisions[div_idx] || ' ' || v_depts[dept_idx]) AND parent_node_id = v_div_node_id AND is_deleted = FALSE;

                -- 4-3. 본부장이 부서 노드에 부서장을 MANAGER 역할로 등록
                SELECT authority_id INTO v_manager_role_id
                FROM role_authorities
                WHERE node_id = v_dept_node_id AND role = 'MANAGER';

                PERFORM add_role(
                    v_div_leader_email,
                    v_dept_leader_email,
                    v_dept_node_id,
                    v_manager_role_id
                );

                -- 4-4. 부서 직속 행정 / 서무 매니저 배정 (MEMBER)
                SELECT authority_id INTO v_member_role_id FROM role_authorities WHERE node_id = v_dept_node_id AND role = 'MEMBER';

                PERFORM register_user('U-' || v_user_counter, v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_admin@samsung.com', v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' 행정담당', v_default_password_hash);
                PERFORM add_role(v_div_leader_email, v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_admin@samsung.com', v_dept_node_id, v_member_role_id);
                v_user_counter := v_user_counter + 1;

                -- =========================================================
                -- 5. 부서 산하 3개 팀 생성 루프
                -- =========================================================
                FOR team_idx IN 1..3 LOOP
                    -- 5-1. 팀장 계정 생성
                    v_team_leader_id := 'U-' || v_user_counter;
                    v_user_counter := v_user_counter + 1;
                    v_team_leader_email := v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_leader@samsung.com';
                    v_team_leader_name := v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀장';

                    PERFORM register_user(
                        v_team_leader_id,
                        v_team_leader_email,
                        v_team_leader_name,
                        v_default_password_hash
                    );

                    -- 5-2. 부서장이 팀 노드 생성 (ADMIN: 부서장)
                    PERFORM create_sub_node(
                        v_dept_leader_email,
                        'TEAM',
                        v_dept_node_id,
                        v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀',
                        v_dept_leader_email
                    );

                    SELECT MAX(node_id) INTO v_team_node_id
                    FROM organization_nodes
                    WHERE node_type = 'TEAM' AND name = (v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀') AND parent_node_id = v_dept_node_id AND is_deleted = FALSE;

                    -- 5-3. 부서장이 팀 노드에 팀장을 MANAGER 역할로 등록
                    SELECT authority_id INTO v_manager_role_id
                    FROM role_authorities
                    WHERE node_id = v_team_node_id AND role = 'MANAGER';

                    PERFORM add_role(
                        v_dept_leader_email,
                        v_team_leader_email,
                        v_team_node_id,
                        v_manager_role_id
                    );

                    -- 5-4. 팀 실무 구성원 배정 (선임 실무자 MEMBER, 주니어 MEMBER, 인턴/보조 VIEWER)
                    SELECT authority_id INTO v_member_role_id FROM role_authorities WHERE node_id = v_team_node_id AND role = 'MEMBER';
                    SELECT authority_id INTO v_viewer_role_id FROM role_authorities WHERE node_id = v_team_node_id AND role = 'VIEWER';

                    -- 1) 선임 실무자 (MEMBER)
                    PERFORM register_user(
                        'U-' || v_user_counter,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_senior@samsung.com',
                        v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀 선임',
                        v_default_password_hash
                    );
                    PERFORM add_role(
                        v_dept_leader_email,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_senior@samsung.com',
                        v_team_node_id,
                        v_member_role_id
                    );
                    v_user_counter := v_user_counter + 1;

                    -- 2) 주니어 담당자 (MEMBER)
                    PERFORM register_user(
                        'U-' || v_user_counter,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_junior@samsung.com',
                        v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀 담당',
                        v_default_password_hash
                    );
                    PERFORM add_role(
                        v_dept_leader_email,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_junior@samsung.com',
                        v_team_node_id,
                        v_member_role_id
                    );
                    v_user_counter := v_user_counter + 1;

                    -- 3) 팀 지원 / 인턴 (VIEWER)
                    PERFORM register_user(
                        'U-' || v_user_counter,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_intern@samsung.com',
                        v_affiliates[a_idx] || ' ' || v_depts[dept_idx] || ' ' || team_idx || '팀 인턴',
                        v_default_password_hash
                    );
                    PERFORM add_role(
                        v_dept_leader_email,
                        v_aff_codes[a_idx] || '_div' || div_idx || '_dept' || dept_idx || '_team' || team_idx || '_intern@samsung.com',
                        v_team_node_id,
                        v_viewer_role_id
                    );
                    v_user_counter := v_user_counter + 1;

                END LOOP; -- 팀 루프 종료
            END LOOP; -- 부서 루프 종료
        END LOOP; -- 본부 루프 종료

        RAISE NOTICE 'Completed seed for affiliate % (%/6)', v_affiliates[a_idx], a_idx;
    END LOOP; -- 계열사 루프 종료

    RAISE NOTICE '=================================================================';
    RAISE NOTICE 'Samsung Enterprise Seed Generation Finished Successfully!';
    RAISE NOTICE 'Total Organization Nodes created: 511';
    RAISE NOTICE 'Total Accounts created: % (Leadership 511 + Staff Members)', (v_user_counter - 100);
    RAISE NOTICE 'All Account Passwords: samsung@1234';
    RAISE NOTICE '=================================================================';
END $$;
