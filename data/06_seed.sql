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
    v_curr_wi_id VARCHAR;
    
    -- 댓글 ID 변수
    v_comm_id_1 INT;
    v_comm_id_2 INT;
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
            p_description => v_companies[c_idx] || ' 차세대 플래그십 라인업 통합 R&D 개발 프로젝트',
            p_category => 'PROJECT',
            p_start_date => '2026-01-01',
            p_due_date => '2026-12-31'
        );
        -- 회사 프로젝트 1 첨부파일 (실제 API처럼 UUID 기반 고유 파일명 적용)
        PERFORM add_work_item_file(
            v_comp_admin_email, 
            v_company_project_id_1, 
            'project_alpha_spec.txt', 
            'a1000000-0000-0000-0000-000000000' || v_company_project_id_1 || '.txt', 
            './uploads/work_items/' || v_company_project_id_1 || '/a1000000-0000-0000-0000-000000000' || v_company_project_id_1 || '.txt', 
            0, 
            'text/plain'
        );
        
        v_company_project_id_2 := 'WI-' || v_wi_counter;
        v_wi_counter := v_wi_counter + 1;
        PERFORM create_work_item(
            p_requester_email => v_comp_admin_email, 
            p_work_item_id => v_company_project_id_2, 
            p_owner_node_id => v_company_node_id, 
            p_owner_user_email => v_comp_admin_email, 
            p_title => v_companies[c_idx] || ' 전사 인프라 최적화', 
            p_description => v_companies[c_idx] || ' 클라우드 마이그레이션 및 서비스 비용 아키텍처 개선 과제',
            p_category => 'INFRA',
            p_start_date => '2026-02-01',
            p_due_date => '2026-11-30'
        );
        -- 회사 프로젝트 2 첨부파일
        PERFORM add_work_item_file(
            v_comp_admin_email, 
            v_company_project_id_2, 
            'infra_optimization_plan.txt', 
            'a2000000-0000-0000-0000-000000000' || v_company_project_id_2 || '.txt', 
            './uploads/work_items/' || v_company_project_id_2 || '/a2000000-0000-0000-0000-000000000' || v_company_project_id_2 || '.txt', 
            0, 
            'text/plain'
        );

        -- 3. 각 회사별 5개 부서 생성 루프
        FOR d_idx IN 1..5 LOOP
            
            -- 3-1. 부서 팀장 계정 생성
            v_dept_leader_id := 'U-' || v_user_counter;
            v_user_counter := v_user_counter + 1;
            v_dept_leader_email := v_comp_names[c_idx] || '_' || d_idx || 'dept_leader@' || v_comp_domains[c_idx];
            v_dept_leader_name := v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀장';
            
            PERFORM register_user(v_dept_leader_id, v_dept_leader_email, v_dept_leader_name, 'leader@1234');
            
            -- 3-2. 상위 회사 노드에 팀장을 MANAGER 역할로 먼저 등록 (선 조건 만족)
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
                p_category => 'FEATURE',
                p_start_date => '2026-03-01',
                p_due_date => '2026-06-30',
                p_parent_work_item_id => v_company_project_id_1
            );
            -- 부서 업무 1 첨부파일
            PERFORM add_work_item_file(
                v_dept_leader_email, 
                v_dept_wi_id_1, 
                'sprint_backlog.txt', 
                'b1000000-0000-0000-0000-000000000' || v_dept_wi_id_1 || '.txt', 
                './uploads/work_items/' || v_dept_wi_id_1 || '/b1000000-0000-0000-0000-000000000' || v_dept_wi_id_1 || '.txt', 
                0, 
                'text/plain'
            );

            -- 회사 프로젝트 1에 팀장/관리자 간 댓글 & 멘션 생성 (d_idx = 1 일 때 등록)
            IF d_idx = 1 THEN
                -- 일반 댓글 2개
                PERFORM add_work_item_comment(v_comp_admin_email, v_company_project_id_1, '프로젝트 Alpha 킥오프를 알립니다.');
                PERFORM add_work_item_comment(v_dept_leader_email, v_company_project_id_1, '기획부에서 일정 및 마일스톤 확인했습니다.');
                
                -- 멘션 댓글 2개
                PERFORM add_work_item_comment(v_comp_admin_email, v_company_project_id_1, '@' || v_dept_leader_name || ' 1분기 상세 목표 전달 바랍니다.');
                SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_company_project_id_1;
                PERFORM add_comment_mention(v_comm_id_1, v_dept_leader_email);
                
                PERFORM add_work_item_comment(v_dept_leader_email, v_company_project_id_1, '@' || v_comp_admin_name || ' 리소스 검토 완료 후 보고드리겠습니다.');
                SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_company_project_id_1;
                PERFORM add_comment_mention(v_comm_id_2, v_comp_admin_email);
            END IF;

            v_dept_wi_id_2 := 'WI-' || v_wi_counter;
            v_wi_counter := v_wi_counter + 1;
            PERFORM create_work_item(
                p_requester_email => v_dept_leader_email,
                p_work_item_id => v_dept_wi_id_2,
                p_owner_node_id => v_dept_node_id,
                p_owner_user_email => v_dept_leader_email,
                p_title => v_depts[d_idx] || ' 품질 및 QA 검증',
                p_description => v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 보안 무결성 분석 및 릴리즈 전 최종 배포 검증',
                p_category => 'QA',
                p_start_date => '2026-04-01',
                p_due_date => '2026-07-31',
                p_parent_work_item_id => v_company_project_id_2
            );
            -- 부서 업무 2 첨부파일
            PERFORM add_work_item_file(
                v_dept_leader_email, 
                v_dept_wi_id_2, 
                'qa_checklist.txt', 
                'b2000000-0000-0000-0000-000000000' || v_dept_wi_id_2 || '.txt', 
                './uploads/work_items/' || v_dept_wi_id_2 || '/b2000000-0000-0000-0000-000000000' || v_dept_wi_id_2 || '.txt', 
                0, 
                'text/plain'
            );

            -- 회사 프로젝트 2에 팀장/관리자 간 댓글 & 멘션 생성 (d_idx = 1 일 때 등록)
            IF d_idx = 1 THEN
                PERFORM add_work_item_comment(v_comp_admin_email, v_company_project_id_2, '인프라 점검 작업을 시작합니다.');
                PERFORM add_work_item_comment(v_dept_leader_email, v_company_project_id_2, '보안 가이드라인 사전 검토 완료했습니다.');
                
                PERFORM add_work_item_comment(v_comp_admin_email, v_company_project_id_2, '@' || v_dept_leader_name || ' 마이그레이션 예산 검토 부탁드립니다.');
                SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_company_project_id_2;
                PERFORM add_comment_mention(v_comm_id_1, v_dept_leader_email);

                PERFORM add_work_item_comment(v_dept_leader_email, v_company_project_id_2, '@' || v_comp_admin_name || ' 승인 요청 문서 올렸습니다.');
                SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_company_project_id_2;
                PERFORM add_comment_mention(v_comm_id_2, v_comp_admin_email);
            END IF;

            -- 3-4. 부서당 5명의 팀원 생성 및 부서노드의 멤버(MEMBER)로 지정
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
                v_curr_wi_id := 'WI-' || v_wi_counter;
                v_wi_counter := v_wi_counter + 1;
                PERFORM create_work_item(
                    p_requester_email => v_dept_leader_email,
                    p_work_item_id => v_curr_wi_id,
                    p_owner_node_id => v_dept_node_id,
                    p_owner_user_email => v_member_email,
                    p_title => v_member_name || ' 담당 실무 과제',
                    p_description => v_member_name || '이 수행하는 단위 세부 기능 개발 및 코드 무결성 확보',
                    p_category => 'TASK',
                    p_start_date => '2026-03-10',
                    p_due_date => '2026-04-30',
                    p_parent_work_item_id => v_dept_wi_id_1
                );

                -- 팀원 실무 과제 첨부파일 1개 등록
                PERFORM add_work_item_file(
                    v_member_email, 
                    v_curr_wi_id, 
                    'task_result_' || m_idx || '.txt', 
                    'c0000000-0000-0000-0000-000000000' || v_curr_wi_id || '.txt', 
                    './uploads/work_items/' || v_curr_wi_id || '/c0000000-0000-0000-0000-000000000' || v_curr_wi_id || '.txt', 
                    0, 
                    'text/plain'
                );

                -- 팀원 실무 과제에 팀장과 팀원 간 댓글 4개 (일반 2개, 멘션 2개)
                -- 1) 일반 댓글 2개
                PERFORM add_work_item_comment(v_member_email, v_curr_wi_id, '업무 할당 확인하였습니다. 개발 시작합니다.');
                PERFORM add_work_item_comment(v_dept_leader_email, v_curr_wi_id, '진행 간 이슈 발생 시 언제든 공유 바랍니다.');
                
                -- 2) 멘션 댓글 2개 (팀장 -> 팀원, 팀원 -> 팀장)
                PERFORM add_work_item_comment(v_dept_leader_email, v_curr_wi_id, '@' || v_member_name || ' 요구사항 명세서 참고하여 진행해 주세요.');
                SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_curr_wi_id;
                PERFORM add_comment_mention(v_comm_id_1, v_member_email);

                PERFORM add_work_item_comment(v_member_email, v_curr_wi_id, '@' || v_dept_leader_name || ' 초안 작성 완료되어 검토 요청드립니다.');
                SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_curr_wi_id;
                PERFORM add_comment_mention(v_comm_id_2, v_dept_leader_email);
            END LOOP;

            -- 부서 업무 1, 2에 팀장과 1번 팀원 간 댓글 4개 추가
            PERFORM add_work_item_comment(v_dept_leader_email, v_dept_wi_id_1, '스프린트 진행 현황 점검합니다.');
            PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem1@' || v_comp_domains[c_idx], v_dept_wi_id_1, '모듈 단위 테스트 진행 중입니다.');
            
            PERFORM add_work_item_comment(v_dept_leader_email, v_dept_wi_id_1, '@' || v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀원1' || ' 코드 리뷰 진행 부탁드립니다.');
            SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_dept_wi_id_1;
            PERFORM add_comment_mention(v_comm_id_1, v_comp_names[c_idx] || '_' || d_idx || 'dept_mem1@' || v_comp_domains[c_idx]);

            PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem1@' || v_comp_domains[c_idx], v_dept_wi_id_1, '@' || v_dept_leader_name || ' 코드 리뷰 완료했습니다.');
            SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_dept_wi_id_1;
            PERFORM add_comment_mention(v_comm_id_2, v_dept_leader_email);

            PERFORM add_work_item_comment(v_dept_leader_email, v_dept_wi_id_2, 'QA 검증 일정 공유합니다.');
            PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem2@' || v_comp_domains[c_idx], v_dept_wi_id_2, '테스트 케이스 준비 완료되었습니다.');

            PERFORM add_work_item_comment(v_dept_leader_email, v_dept_wi_id_2, '@' || v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀원2' || ' 회귀 테스트 케이스 업데이트 바랍니다.');
            SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_dept_wi_id_2;
            PERFORM add_comment_mention(v_comm_id_1, v_comp_names[c_idx] || '_' || d_idx || 'dept_mem2@' || v_comp_domains[c_idx]);

            PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem2@' || v_comp_domains[c_idx], v_dept_wi_id_2, '@' || v_dept_leader_name || ' 업데이트 완료했습니다.');
            SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_dept_wi_id_2;
            PERFORM add_comment_mention(v_comm_id_2, v_dept_leader_email);

            -- 3-5. 부서 하위에 팀 노드 2개 생성 (1팀, 2팀)
            FOR t_idx IN 1..2 LOOP
                PERFORM create_sub_node(v_dept_leader_email, 'TEAM', v_dept_node_id, v_companies[c_idx] || ' ' || v_depts[d_idx] || ' ' || t_idx || '팀', v_dept_leader_email);
                
                -- 생성된 팀 node_id 가져오기
                SELECT MAX(node_id) INTO v_team_node_id 
                FROM organization_nodes 
                WHERE node_type = 'TEAM' AND name = v_companies[c_idx] || ' ' || v_depts[d_idx] || ' ' || t_idx || '팀' AND is_deleted = FALSE;
                
                -- 팀 단위 공통 업무 1개 생성 (부모: 부서 업무)
                v_curr_wi_id := 'WI-' || v_wi_counter;
                v_wi_counter := v_wi_counter + 1;
                PERFORM create_work_item(
                    p_requester_email => v_dept_leader_email,
                    p_work_item_id => v_curr_wi_id,
                    p_owner_node_id => v_team_node_id,
                    p_owner_user_email => v_dept_leader_email,
                    p_title => v_depts[d_idx] || ' ' || t_idx || '팀 현안 검토',
                    p_description => v_depts[d_idx] || ' ' || t_idx || '팀원들이 함께 완수할 단기 TODO 스크럼 과제',
                    p_category => 'MEETING',
                    p_start_date => '2026-04-01',
                    p_due_date => '2026-05-15',
                    p_parent_work_item_id => v_dept_wi_id_2
                );

                -- 팀 단위 업무 첨부파일 1개 등록
                PERFORM add_work_item_file(
                    v_dept_leader_email, 
                    v_curr_wi_id, 
                    'team_meeting_notes.txt', 
                    'd0000000-0000-0000-0000-000000000' || v_curr_wi_id || '.txt', 
                    './uploads/work_items/' || v_curr_wi_id || '/d0000000-0000-0000-0000-000000000' || v_curr_wi_id || '.txt', 
                    0, 
                    'text/plain'
                );

                -- 팀 단위 업무 댓글 4개 (일반 2개, 멘션 2개)
                PERFORM add_work_item_comment(v_dept_leader_email, v_curr_wi_id, '팀 미팅 아젠다를 확인해 주세요.');
                PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem' || t_idx || '@' || v_comp_domains[c_idx], v_curr_wi_id, '회의 참석 준비 완료했습니다.');

                PERFORM add_work_item_comment(v_dept_leader_email, v_curr_wi_id, '@' || v_companies[c_idx] || ' ' || v_depts[d_idx] || ' 팀원' || t_idx || ' 회의록 정리 담당해 주세요.');
                SELECT MAX(comment_id) INTO v_comm_id_1 FROM work_item_comments WHERE work_item_id = v_curr_wi_id;
                PERFORM add_comment_mention(v_comm_id_1, v_comp_names[c_idx] || '_' || d_idx || 'dept_mem' || t_idx || '@' || v_comp_domains[c_idx]);

                PERFORM add_work_item_comment(v_comp_names[c_idx] || '_' || d_idx || 'dept_mem' || t_idx || '@' || v_comp_domains[c_idx], v_curr_wi_id, '@' || v_dept_leader_name || ' 회의록 첨부파일 확인 부탁드립니다.');
                SELECT MAX(comment_id) INTO v_comm_id_2 FROM work_item_comments WHERE work_item_id = v_curr_wi_id;
                PERFORM add_comment_mention(v_comm_id_2, v_dept_leader_email);
            END LOOP;
            
        END LOOP;
    END LOOP;

    RAISE NOTICE 'Seed generation successfully completed! Total Users: 124, Total WorkItems: 188, Comments & Mentions & Files populated!';
END $$;