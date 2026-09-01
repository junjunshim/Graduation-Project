-- =========================================================================
-- 4대 기업 시나리오 기반 대규모 통합 테스트 시드 데이터 생성
-- OS & DB 컨테이너 초기화 시 자동으로 구동됩니다.
-- =========================================================================

DO $$
DECLARE
    -- 4대 회사 정의
    v_companies VARCHAR[] := ARRAY['삼성', 'LG', '애플', '마이크로소프트'];
    v_comp_domains VARCHAR[] := ARRAY['samsung.com', 'lg.com', 'apple.com', 'microsoft.com'];
    v_comp_names VARCHAR[] := ARRAY['samsung', 'lg', 'apple', 'ms'];
    
    -- 부서 목록 정의 (부서당 5개)
    v_depts VARCHAR[] := ARRAY['기획부', '개발부', '인사부', '마케팅부', '재무부'];
    
    -- 루프 변수
    c_idx INT;
    d_idx INT;
    t_idx INT;
    m_idx INT;
    
    -- 계정 생성용 변수
    v_comp_admin_email VARCHAR;
    v_comp_admin_name VARCHAR;
    v_comp_admin_id VARCHAR;
    
    v_dept_leader_email VARCHAR;
    v_dept_leader_name VARCHAR;
    v_dept_leader_id VARCHAR;
    
    v_member_email VARCHAR;
    v_member_name VARCHAR;
    v_member_id VARCHAR;
    
    -- 노드 매핑용 변수
    v_company_node_id INT;
    v_dept_node_id INT;
    v_team_node_id INT;
    
    -- 카운터 (중복 방지용 고유값 생성)
    v_user_counter INT := 100;
    v_wi_counter INT := 100;
    
    -- 업무 연계용 변수
    v_company_project_id_1 VARCHAR;
    v_company_project_id_2 VARCHAR;
    v_dept_wi_id_1 VARCHAR;
    v_dept_wi_id_2 VARCHAR;
BEGIN
    RAISE NOTICE 'Starting seed generation for 4 major companies...';

    -- 4대 회사 생성 루프
    FOR c_idx IN 1..4 LOOP
        
        -- 1. 회사 최고 관리자 계정 생성 (ADMIN)
        v_comp_admin_id := 'U-' || v_user_counter;
        v_user_counter := v_user_counter + 1;
        v_comp_admin_email := v_comp_names[c_idx] || '_admin@' || v_comp_domains[c_idx];
        v_comp_admin_name := v_companies[c_idx] || ' 계정 관리자';
        
        -- 패스워드는 'samsung@1234', 'lg@1234' 형태로 설정
        PERFORM register_user(v_comp_admin_id, v_comp_admin_email, v_comp_admin_name, v_comp_names[c_idx] || '@1234');
        
        -- 2. 회사 최상위 노드 생성
        PERFORM create_top_node(v_comp_admin_email, 'COMPANY', v_companies[c_idx]);
        
        -- 방금 생성된 최상위 회사의 node_id 가져오기
        SELECT MAX(node_id) INTO v_company_node_id 
        FROM organization_nodes 
        WHERE node_type = 'COMPANY' AND name = v_companies[c_idx] AND is_deleted = FALSE;
        
        -- 회사 단위 대형 프로젝트 업무 생성 (2개)
        v_company_project_id_1 := 'WI-' || v_wi_counter;
        v_wi_counter := v_wi_counter + 1;
        PERFORM create_work_item(
            p_requester_email => v_comp_admin_email, 
            p_work_item_id => v_company_project_id_1, 
            p_owner_node_id => v_company_node_id, 
            p_owner_user_email => v_comp_admin_email, 
            p_title => v_companies[c_idx] || ' 핵심 프로젝트 Alpha', 
            p_description => v_companies[c_idx] || ' 차세대 플래그십 라인업 통합 R&D 개발 프로젝트'
        );
        
        v_company_project_id_2 := 'WI-' || v_wi_counter;
        v_wi_counter := v_wi_counter + 1;
        PERFORM create_work_item(
            p_requester_email => v_comp_admin_email, 
            p_work_item_id => v_company_project_id_2, 
            p_owner_node_id => v_company_node_id, 
            p_owner_user_email => v_comp_admin_email, 
            p_title => v_companies[c_idx] || ' 전사 인프라 최적화', 
            p_description => v_companies[c_idx] || ' 클라우드 마이그레이션 및 서비스 비용 아키텍처 개선 과제'
        );

        -- 3. 각 회사별 5개 부서 생성 루프
        FOR d_idx IN 1..5 LOOP
            
            -- 3-1. 부서 팀장 계정 생성
            v_dept_leader_id := 'U-' || v_user_counter;
            v_user_counter := v_user_counter + 1;
            v_dept_leader_email := v_comp_names[c_idx] || '_' || d_idx || 'dept_leader@' || v_comp_domains[c_idx];
            v_dept_leader_name := v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀장';
            
            PERFORM register_user(v_dept_leader_id, v_dept_leader_email, v_dept_leader_name, 'leader@1234');
            
            -- 3-2. (수정) 상위 회사 노드에 팀장을 MANAGER 역할로 먼저 등록 (선 조건 만족)
            PERFORM add_role(v_comp_admin_email, v_dept_leader_email, v_company_node_id, 'MANAGER');
            
            -- 3-3. 부서 노드 생성 (이때 팀장이 부서노드의 관리자(ADMIN)로 소속 및 지정됨)
            PERFORM create_sub_node(v_comp_admin_email, 'DEPARTMENT', v_company_node_id, v_companies[c_idx] || ' ' || v_depts[d_idx], v_dept_leader_email);
            
            -- 생성된 부서 노드의 node_id 가져오기
            SELECT MAX(node_id) INTO v_dept_node_id 
            FROM organization_nodes 
            WHERE node_type = 'DEPARTMENT' AND name = v_companies[c_idx] || ' ' || v_depts[d_idx] AND is_deleted = FALSE;
            
            -- 부서 단위 세부 작업 생성 (2개) - 부모 업무를 회사 프로젝트로 지정
            v_dept_wi_id_1 := 'WI-' || v_wi_counter;
            v_wi_counter := v_wi_counter + 1;
            PERFORM create_work_item(
                p_requester_email => v_dept_leader_email,
                p_work_item_id => v_dept_wi_id_1,
                p_owner_node_id => v_dept_node_id,
                p_owner_user_email => v_dept_leader_email,
                p_title => v_depts[d_idx] || ' 세부 구현 스프린트',
                p_description => v_companies[c_idx] || ' ' || v_depts[d_idx] || '의 세부 마일스톤 기획 및 리소스 설계',
                p_parent_work_item_id => v_company_project_id_1
            );
            
            v_dept_wi_id_2 := 'WI-' || v_wi_counter;
            v_wi_counter := v_wi_counter + 1;
            PERFORM create_work_item(
                p_requester_email => v_dept_leader_email,
                p_work_item_id => v_dept_wi_id_2,
                p_owner_node_id => v_dept_node_id,
                p_owner_user_email => v_dept_leader_email,
                p_title => v_depts[d_idx] || ' 품질 및 QA 검증',
                p_description => v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 보안 무결성 분석 및 릴리즈 전 최종 배포 검증',
                p_parent_work_item_id => v_company_project_id_2
            );

            -- 3-4. 부서당 5명의 팀원 생성 및 부서노드의 멤버(MEMBER)로 지정
            -- (팀원 또한 부서의 MEMBER가 되기 전, 상위 회사 노드에 MEMBER 역할 선 등록이 필요할 수 있으므로 상위-하위 순차 등록 처리 진행)
            FOR m_idx IN 1..5 LOOP
                v_member_id := 'U-' || v_user_counter;
                v_user_counter := v_user_counter + 1;
                v_member_email := v_comp_names[c_idx] || '_' || d_idx || 'dept_mem' || m_idx || '@' || v_comp_domains[c_idx];
                v_member_name := v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀원' || m_idx;
                
                PERFORM register_user(v_member_id, v_member_email, v_member_name, 'member@1234');
                
                -- 팀원을 먼저 상위 회사 노드의 MEMBER로 추가
                PERFORM add_role(v_comp_admin_email, v_member_email, v_company_node_id, 'MEMBER');
                
                -- 이후 하위 부서 노드의 MEMBER로 역할 배정
                PERFORM add_role(v_dept_leader_email, v_member_email, v_dept_node_id, 'MEMBER');
                
                -- 팀원별로 개인 상세 할당 업무(Work Item) 1개씩 생성
                PERFORM create_work_item(
                    p_requester_email => v_dept_leader_email,
                    p_work_item_id => 'WI-' || v_wi_counter,
                    p_owner_node_id => v_dept_node_id,
                    p_owner_user_email => v_member_email,
                    p_title => v_member_name || ' 담당 실무 과제',
                    p_description => v_member_name || '이 수행하는 단위 세부 기능 개발 및 코드 무결성 확보',
                    p_parent_work_item_id => v_dept_wi_id_1
                );
                v_wi_counter := v_wi_counter + 1;
            END LOOP;

            -- 3-5. 부서 하위에 팀 노드 2개 생성 (1팀, 2팀)
            -- 요구사항: 팀 노드는 별도 역할 지정 없이 부서 노드의 역할을 상속받음
            FOR t_idx IN 1..2 LOOP
                PERFORM create_sub_node(v_dept_leader_email, 'TEAM', v_dept_node_id, v_companies[c_idx] || ' ' || v_depts[d_idx] || ' ' || t_idx || '팀', v_dept_leader_email);
                
                -- 생성된 팀 node_id 가져오기
                SELECT MAX(node_id) INTO v_team_node_id 
                FROM organization_nodes 
                WHERE node_type = 'TEAM' AND name = v_companies[c_idx] || ' ' || v_depts[d_idx] || ' ' || t_idx || '팀' AND is_deleted = FALSE;
                
                -- 팀 단위 공통 업무 1개 생성 (부모: 부서 업무)
                PERFORM create_work_item(
                    p_requester_email => v_dept_leader_email,
                    p_work_item_id => 'WI-' || v_wi_counter,
                    p_owner_node_id => v_team_node_id,
                    p_owner_user_email => v_dept_leader_email,
                    p_title => v_depts[d_idx] || ' ' || t_idx || '팀 현안 검토',
                    p_description => v_depts[d_idx] || ' ' || t_idx || '팀원들이 함께 완수할 단기 TODO 스크럼 과제',
                    p_parent_work_item_id => v_dept_wi_id_2
                );
                v_wi_counter := v_wi_counter + 1;
            END LOOP;
            
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Seed generation successfully completed! Total Users: 124, Total Companies: 4, Total Departments: 20, Total Teams: 40';
END $$;