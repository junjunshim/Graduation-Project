# 🧭 협업 To-Do + Git 연동 시스템 설계서
**"OrganizationNode 기반의 유연한 계층 구조 협업 플랫폼"**

## 1. 핵심 설계 철학
* **모든 주체는 노드(Node)다**: 회사, 부서, 팀, 개인은 모두 `OrganizationNode`로 추상화됩니다.
* **업무의 통합**: 대규모 프로젝트부터 사소한 Todo까지 `WorkItem` 하나로 관리하며 계층 구조를 형성합니다.
* **확장성 중심**: 유저는 가입 시 개인 공간을 먼저 할당받고, 필요에 따라 여러 팀 공간에 소속되는 유연한 구조를 가집니다.

---

## 2. ERD 구조 (Entity Relationship Diagram)



### 📊 주요 테이블 명세

1. **`organization_nodes`**: 모든 공간과 주체의 트리 구조를 담당
    - `node_id`: (PK, 개인 사용자 시 => users.personal_node_id) 
    - `node_type`: COMPANY, DIVISION, TEAM, USER 등
    - `parent_node_id`: 상위 노드 참조 (Self-referencing)
    - `path`: 트리 탐색 최적화를 위한 경로 저장 (예: `1/5/12/`)
    - `name`: 조직명 or 사용자 이름
    - `created_at`: timestamp
2. **`users`**: 실제 서비스 이용자 정보
    - `user_id`: (PK)
    - `email`: 로그인 및 git 매핑용
    - `password_hash`: 비밀번호
    - `personal_node_id`: 가입 시 생성되는 개인 전용 노드와 1:1 매칭
3. **`role_assignments`**: 유저-노드 간의 권한 매핑
    - `id`: (PK)
    - `user_id`: (FK -> users.user_id)
    - `node_id`: (FK -> organization_nodes.node_id)
    - `role`: 어떤 유저가 어떤 노드에서 어떤 역할(ADMIN, MEMBER 등)을 하는지 정의

4. **`work_items`**: 업무 및 프로젝트 데이터
    - `work_item_id`: (PK, "WI-" 접두어 사용 권장)
    - `owner_node_id`: (FK -> organization_nodes.node_id): 이 업무가 귀속된 조직/개인
    - `parent_work_item_id`: (FK, self-referencing, Nullable): 상위 프로젝트/업무
    - `title`: 프로젝트 명 또는 작업명
    - `description`: 설명
    - `status`: 작업 상태(ex: todo, in_progress, review, done 등)
    - `priority`: 작업 우선순위(ex: low, medium, high 등)
    - `weight`: 작업 간 가중치(상위 작업의 진행률 계산 가중치)
    - `progress`: 진행률, 시스템 자동 계산 값
    - `start_date`: 작업 시작일
    - `due_date` : 작업 마감일
    - `created_at`: 작업 생성 일
---

## 3. 각 테이블의 데이터 예시

1. `organization_node`: 조직의 뼈대<br>
먼저 회사의 구조를 트리 형태로 만듭니다. 여기서 사용자(Kim) 본인도 하나의 노드가 된다는 점이 포인트입니다.

| node_id | node_type | parent_node_id | name | path |
| :---: | :---: | :---: | :---: | :---: |
| 999 | user | NULL | 김철수 | 999/ |
| 100 | company | NULL | 클라우드나인 | 100/ |
| 200 | department | 100 | 백앤드 개발부 | 100/200/ |
| 300 | team | 200 | api 개발팀 | 100/200/300/ |

- 작업 영역을 나타낸다, 위에서 부터 김철수 개인 공간, 회사, 부서, 팀 
---

2. `users`: 실제 로그인 계정<br>
사용자 노드(999)와 실제 로그인 계정 정보를 연결합니다.

| user_id | email | name | pearsonal_node_id |
| :---: | :---: | :---: | :---: |
| U-1 | kim@email.com | 김철수 | 999(node_id) |
- 김철수라는 유저의 정보를 담고 있다.
---

3. `role_assignments`: 누가 어떤 역할인가?<br>
김철수(U-1)가 어느 범위까지 영향력을 행사할 수 있는지 정의합니다.
(admin, manager 등)

| id | user_id | node_id | role |
| :---: | :---: | :---: | :---: |
| 1 | U-1 | 300 | manager |
| 2 | U-1 | 999 | admin |
- 작업영역에 대한 사용자의 권한을 나타낸다. U-1(김철수)가 node_id가 300인 영역에서 manager 그리고 node_id가 999인 영역에서 admin
---

4. `work_items`: 업무와 할 일

| work_item_id | title | owner_node_id | parent_id | status | progress | 
| :---: | :---: | :---: | :---: | :---: | :---: |
| WI-1 | 2024 신규 서비스 런칭 | 100 | NULL | in_progress | 30% |
| WI-2 | 인증 api 서버 구축 | 300 | WI-1 | in_progress | 50% |
| WI-3 | db 스키마 설계 | 999 | WI-2 | done | 100%|
- 업무의 정보를 저장
---

## 4. 시스템 운영 흐름 (Lifecycle)

### 🔄 회원가입부터 협업까지의 Flow



1. **Phase 1 (Signup)**: 유저 가입 → `users` 생성 → 독립적인 `USER` 타입 노드(`parent_node_id: NULL`) 자동 생성 → 본인 노드에 대한 `ADMIN` 권한 부여.
2. **Phase 2 (Create Space)**: 유저가 팀 공간 생성 → 새로운 `TEAM` 타입 노드 생성 → 생성자에게 해당 팀 `ADMIN` 권한 부여.
3. **Phase 3 (Invite)**: 타 유저 초대 → 초대받은 유저에게 해당 팀 노드에 대한 `MEMBER` 권한 추가 부여.
4. **Phase 4 (Work)**: 팀 노드를 소유주(`owner_node_id`)로 하는 `WorkItem` 생성 → 팀원 전체가 업무 공유 및 수행.

---

## 4. 데이터베이스 쿼리 예시 (Step-by-Step)

### 1. 유저 가입 및 개인 공간 초기화
```sql
-- 1. 유저 정보 저장
INSERT INTO users (user_id, email, name) VALUES ('U-101', 'kim@test.com', '김철수');

-- 2. 개인 전용 노드 생성 (부모 없음 = 독립 공간)
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (999, 'USER', NULL, '김철수의 개인공간', '999/');

-- 3. 유저와 노드 매핑 및 권한 부여
UPDATE users SET personal_node_id = 999 WHERE user_id = 'U-101';
INSERT INTO role_assignments (user_id, node_id, role) VALUES ('U-101', 999, 'ADMIN');
``` 

### 2. 팀 생성 및 팀원 추가
```sql
--- 1. 팀 생성
INSERT INTO organization_nodes (node_id, node_type, parent_node_id, name, path)
VALUES (500, 'TEAM', NULL, '프론트엔드 개발팀', '500/');

--- 2. 팀 생성자에 관리자 권한 부여
INSERT INTO role_assignments (user_id, node_id, role)
VALUES ('U-101', 500, 'ADMIN');

---3. 유저 조회 및 팀원 추가
SELECT user_id FROM users WHERE email = 'lee@email.com'; -- 결과: 'U-102'
INSERT INTO role_assignments (user_id, node_id, role)
VALUES ('U-102', 500, 'MEMBER'); -- 'U-102 유저에게 멤버 권한 부여'
```

### 3. 팀 소유 업무 생성 및 팀원에게 배정
```sql
--- 1.팀 업무 생성
INSERT INTO work_items (work_item_id, title, owner_node_id, status)
VALUES ('WI-201', '메인 페이지 UI 개발', 500, 'TODO');

--- 2. 팀원에게 배정
SELECT personal_node_id FROM users WHERE user_id = 'U-101'; -- 결과: 999
-- WI-201(팀 업무)의 자식 업무인 WI-201-1을 생성하여 김철수 개인 노드(999)에 할당
INSERT INTO work_items (work_item_id, title, owner_node_id, parent_work_item_id, status)
VALUES ('WI-201-1', '[배정] 메인 페이지 레이아웃 작업', 999, 'WI-201', 'TODO');
```