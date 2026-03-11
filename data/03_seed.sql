-- 1. 데이터베이스 시드 데이터 생성
-- 실제 데이터 생성 로직 순서대로 데이터 입력

-- #1 유저 생성 로직 (이후 password 해싱 값으로 변경)
/* 유저 시드 생성
매개변수 => user_id, email, name, password_hash
-- 1) 유저 생성
INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('', '', '', '')
RETURNING user_id AS new_user_id, name AS new_user_name \gset

-- 2) 개인 전용 노드 생성 및 매핑
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset

UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';

UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;

-- 3) 전용 노드에 대한 권한 매핑
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');
*/


-- 1) 유저 생성
INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-1', 'admin@gmail.com', '관리자', 'admin@1234')
RETURNING user_id AS new_user_id, name AS new_user_name \gset

-- 2) 개인 전용 노드 생성 및 매핑
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset

UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';

UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;

-- 3) 전용 노드에 대한 권한 매핑
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

-- 추가 유저 생성
INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-2', 'kim1234@naver.com', '김철수', 'kim@1234')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-3', 'na1234@naver.com', '나영희', 'na@1234')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-4', 'da5678@gmail.com', '다람쥐', 'da@5678')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-5', 'ra9988@gmail.com', '라랄라', 'ra!9988')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-6', 'ma6767@naver.com', '마맘미아', 'ma!9191')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-7', 'ba3409@naver.com', '바할라', 'baba22@!')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-8', 'sa1231@gmail.com', '사사삭', 'sasasak@1122')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

INSERT INTO users (user_id, email, name, password_hash) 
VALUES ('U-10', 'samsung3333@gmail.com', '삼성회사 계정 관리자', 'samsung@3333')
RETURNING user_id AS new_user_id, name AS new_user_name \gset
INSERT INTO organization_nodes (node_type, parent_node_id, name, path)
VALUES ('USER', NULL, :'new_user_name' || ' 개인공간', '{}') 
RETURNING node_id AS new_node_id \gset
UPDATE users SET personal_node_id = :new_node_id WHERE user_id = :'new_user_id';
UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;
INSERT INTO role_assignments (user_id, node_id, role) 
VALUES (:'new_user_id', :new_node_id, 'ADMIN');

-- #2 팀 생성 및 팀원 추가 로직
/*
-- 최상위 노드 생성
SELECT create_top_node($1, $2, $3, $4);

-- 2) 노드에 유저 추가는 이메일을 통해서 진행됨 (해당 노드 id와 이메일을 매개변수로 입력받는다)
WITH selected_user AS (
    SELECT user_id FROM users WHERE email = ''
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, , ''
FROM selected_user;

-- 3) 부서 추가(하위 노드 추가★★★★★)(매개변수 상위 노드의 node_id)
INSERT INTO organization_nodes (node_type, parent_node_id, name, path) 
VALUES ('DEPARTMENT', , '', '{}')
RETURNING node_id AS new_node_id \gset

UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;

WITH parent_info AS (
    SELECT path FROM organization_nodes WHERE node_id = 
)
UPDATE organization_nodes 
SET path = p.path || (SELECT path FROM organization_nodes WHERE node_id = :new_node_id)
FROM parent_info p 
WHERE node_id = :new_node_id;
*/

-- 1) 최상위 노드 생성
SELECT create_top_node('COMPANY', '삼성', 'U-10', 'ADMIN');

-- 2) 노드에 유저 추가는 이메일을 통해서 진행됨 (해당 노드 id와 이메일을 매개변수로 입력받는다)
WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'kim1234@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 10, 'MANAGER'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'na1234@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 10, 'MANAGER'
FROM selected_user;

-- 3) 부서 추가(하위 노드 추가★★★★★)(매개변수 상위 노드의 node_id)
INSERT INTO organization_nodes (node_type, parent_node_id, name, path) 
VALUES ('DEPARTMENT', 10, '개발부서', '{}')
RETURNING node_id AS new_node_id \gset

UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;

WITH parent_info AS (
    SELECT path FROM organization_nodes WHERE node_id = 10 
)
UPDATE organization_nodes 
SET path = p.path || (SELECT path FROM organization_nodes WHERE node_id = :new_node_id)
FROM parent_info p 
WHERE node_id = :new_node_id;

INSERT INTO organization_nodes (node_type, parent_node_id, name, path) 
VALUES ('DEPARTMENT', 10, '영업부서', '{}')
RETURNING node_id AS new_node_id \gset

UPDATE organization_nodes SET path = ARRAY[:new_node_id] WHERE node_id = :new_node_id;

WITH parent_info AS (
    SELECT path FROM organization_nodes WHERE node_id = 10 
)
UPDATE organization_nodes 
SET path = p.path || (SELECT path FROM organization_nodes WHERE node_id = :new_node_id)
FROM parent_info p 
WHERE node_id = :new_node_id;

-- 4) 부서에 팀장 추가(상위 노드의 admin이 하위 노드의 admin 권한 부여)(매개변수 상위 node_id, 담당할 사람의 email)
WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'kim1234@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 11, 'ADMIN'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'na1234@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 12, 'ADMIN'
FROM selected_user;

-- 5) 부서에 팀원 추가 (매개변수 해당 노드 node_id , 유저 이메일)
WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'da5678@gmail.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 11, 'MEMBER'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'ra9988@gmail.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 11, 'MEMBER'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'ma6767@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 11, 'MEMBER'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'ba3409@naver.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 12, 'MEMBER'
FROM selected_user;

WITH selected_user AS (
    SELECT user_id FROM users WHERE email = 'sa1231@gmail.com'
)
INSERT INTO role_assignments (user_id, node_id, role) 
SELECT user_id, 12, 'MEMBER'
FROM selected_user;

-- #3 작업 생성 및 팀원 배정
/*
-- 노드의 최상위 업무 생성(해당 노드의 id, 담당할 유저의 user_id 매개변수)
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-', , NULL, '', '', '');

-- 하위 업무 생성(상위 업무의 work_item_id를 추가로 매개변수로 입력)
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-', , 'WI-', '', '', '');

*/
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-1', 10, NULL, 'U-10', 'S26', 'S26 관련 통합 TODO');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-2', 10, 'WI-1', 'U-2', 'S26 보안 프로그램 개발', '개발 부서가 맡을 프로젝트');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-3', 10, 'WI-1', 'U-3', 'S26 신규 시장 개척', '영업 부서가 맡을 프로젝트');

-- 상위 노드의 업무를 하위 노드의 업무로 가져오기
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-4', 11, 'WI-2', 'U-2', 'S26 보안 프로그램 개발', '개발 부서가 맡을 프로젝트');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-5', 12, 'WI-3', 'U-3', 'S26 보안 프로그램 개발', '개발 부서가 맡을 프로젝트');

-- 업무 생성 및 팀원 배정
INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-6', 11, 'WI-4', 'U-4', '악성 코드 분석/탐지 도구 개발', '악성코드를 자동으로 분석하고 진단하는 백신 및 탐지 시스템');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-7', 11, 'WI-4', 'U-5', '보안 솔루션 개발', '난독화, 무결성 검증, 암호화, 접근 제어 등 보안 솔루션 개발');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-8', 11, 'WI-4', 'U-6', '신규 시장 후보군 선정', '시장성이 있는 지역 선정하여 후보군 마련');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-9', 12, 'WI-5', 'U-7', '현지화 제품에 들어갈 기능 선정', '해당 시장에서 성공할 수 있는 기능 선정');

INSERT INTO work_items (work_item_id, owner_node_id, parent_work_item_id, owner_user_id, title, description) 
VALUES ('WI-10', 12, 'WI-5', 'U-8', '마케팅 및 유통 전략 선정', '현지에 맞는 마케팅 방법과 유통 전략을 선정');
