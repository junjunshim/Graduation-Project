-- 1. 데이터베이스 시드 데이터 생성
-- 실제 데이터 생성 로직 순서대로 데이터 입력

-- #1 유저 생성 로직 (이후 password 해싱 값으로 변경)
/* 유저 시드 생성
INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-', '@.com', '', '');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (, 'USER', NULL, '', ARRAY[]);

UPDATE users SET personal_node_id = WHERE user_id = 'U-';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (, 'U-', , 'ADMIN');
*/


-- 1) 유저 생성
 INSERT INTO users (user_id, email, name, password_hash) 
 VALUES ('U-1', 'admin@gmail.com', '관리자', 'admin@1234');

-- 2) 개인 전용 노드 생성 및 매핑
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (1, 'USER', NULL, '관리자 개인공간', ARRAY[1]);

UPDATE users SET personal_node_id = 1 WHERE user_id = 'U-1';

-- 3) 전용 노드에 대한 권한 매핑
INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (1, 'U-1', 1, 'ADMIN');

-- 추가 유저 생성
INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-2', 'kim1234@naver.com', '김철수', 'kim@1234');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (2, 'USER', NULL, '김철수 개인공간', ARRAY[2]);

UPDATE users SET personal_node_id = 2 WHERE user_id = 'U-2';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (2, 'U-2', 2, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-3', 'na1234@naver.com', '나영희', 'na@1234');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (3, 'USER', NULL, '나영희 개인공간', ARRAY[3]);

UPDATE users SET personal_node_id = 3 WHERE user_id = 'U-3';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (3, 'U-3', 3, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-4', 'da5678@gmail.com', '다람쥐', 'da@5678');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (4, 'USER', NULL, '다람쥐 개인공간', ARRAY[4]);

UPDATE users SET personal_node_id = 4 WHERE user_id = 'U-4';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (4, 'U-4', 4, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-5', 'ra9988@gmail.com', '라랄라', 'ra!9988');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (5, 'USER', NULL, '라랄라 개인공간', ARRAY[5]);

UPDATE users SET personal_node_id = 5 WHERE user_id = 'U-5';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (5, 'U-5', 5, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-6', 'ma6767@naver.com', '마맘미아', 'ma!9191');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (6, 'USER', NULL, '마맘미아 개인공간', ARRAY[6]);

UPDATE users SET personal_node_id = 6 WHERE user_id = 'U-6';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (6, 'U-6', 6, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-7', 'ba3409@naver.com', '바할라', 'baba22@!');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (7, 'USER', NULL, '바할라 개인공간', ARRAY[7]);

UPDATE users SET personal_node_id = 7 WHERE user_id = 'U-7';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (7, 'U-7', 7, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-8', 'sa1231@gmail.com', '사사삭', 'sasasak@1122');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (8, 'USER', NULL, '사사삭 개인공간', ARRAY[8]);

UPDATE users SET personal_node_id = 8 WHERE user_id = 'U-8';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (8, 'U-8', 8, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash)
VALUES ('U-10', 'samsung3333@gmail.com', '삼성회사 계정 관리자', 'samsung@3333');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (10, 'USER', NULL, '삼성회사 계정 관리자 개인공간', ARRAY[10]);

UPDATE users SET personal_node_id = 10 WHERE user_id = 'U-10';

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (10, 'U-10', 10, 'ADMIN');

-- #2 팀 생성 및 팀원 추가 로직
/*
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (, 'COMPANY', NULL, '', ARRAY[]);

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (, '', , 'ADMIN');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (, '', , 'MANAGER');
*/

-- 1) 회사 전용 노드 생성
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (100, 'COMPANY', NULL, '삼성', ARRAY[100]);

-- 2) 회사 관리자 계정에 권한 부여
INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (100, 'U-10', 100, 'ADMIN');

-- 3) 회사 전용 노드에 부서 팀장들 권한 매핑(회사 노드의 매니저)
INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (101, 'U-1', 100, 'MANAGER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role)
VALUES (102, 'U-2', 100, 'MANAGER');

-- 4) 부서 추가 및 부서 팀장들 관리자로 추가
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (200, 'DEPARTMENT', 100, '개발부서', ARRAY[100, 200]);

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (200, 'U-1', 200, 'ADMIN');

INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path) 
VALUES (300, 'DEPARTMENT', 100, '영업부서', ARRAY[100, 300]);

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (300, 'U-2', 300, 'ADMIN');

-- 5) 부서에 팀원 추가
INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (201, 'U-3', 200, 'MEMBER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (202, 'U-4', 200, 'MEMBER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (203, 'U-5', 200, 'MEMBER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (301, 'U-6', 300, 'MEMBER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (302, 'U-7', 300, 'MEMBER');

INSERT INTO role_assignments (assignment_id, user_id, node_id, role) 
VALUES (303, 'U-8', 300, 'MEMBER');

-- #3 작업 생성 및 팀원 배정

-- 1) 회사 전체 업무 생성
-- 최상위 업무 생성
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-100', 100, NULL, 'U-10', 'S26', 'S26 관련 통합 TODO');

-- 하위 업무 생성
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-101', 100, 'WI-100', 'U-1', 'S26 보안 프로그램 개발', '개발 부서가 맡을 프로젝트');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-102', 100, 'WI-100', 'U-2', 'S26 신규 시장 개척', '영업 부서가 맡을 프로젝트');

-- 상위 노드의 업무를 하위 노드의 업무로 가져오기
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-200', 200, 'WI-101', 'U-1', 'S26 보안 프로그램 개발', '개발 부서가 맡을 프로젝트');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-300', 300, 'WI-102', 'U-2', 'S26 신규 시장 개척', '영업 부서가 맡을 프로젝트');

-- 업무 생성 및 팀원 배정
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-201', 200, 'WI-200', 'U-3', '악성 코드 분석/탐지 도구 개발', '악성코드를 자동으로 분석하고 진단하는 백신 및 탐지 시스템');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-202', 200, 'WI-200', 'U-4', '모의 해킹 자동화 도구 개발', '취약점 분석 효율을 높이기 위한 자동화 도구');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-203', 200, 'WI-200', 'U-5', '보안 솔루션 개발', '난독화, 무결성 검증, 암호화, 접근 제어 등 보안 솔루션 개발');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-301', 300 , 'WI-300', 'U-6', '신규 시장 후보군 선정', '시장성이 있는 지역 선정하여 후보군 마련');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-302', 300 , 'WI-300', 'U-7', '현지화 제품에 들어갈 기능 선정', '해당 시장에서 성공할 수 있는 기능 선정');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-303', 300 , 'WI-300', 'U-8', '마케팅 및 유통 전략 선정', '현지에 맞는 마케팅 방법과 유통 전략을 선정');