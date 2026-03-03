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

-- #2 팀 생성 및 팀원 추가 로직
