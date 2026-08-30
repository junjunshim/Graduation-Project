# 프론트엔드 Mock/실제 서버 API 연동

작성일: 2026-08-29 (최종 갱신: 2026-08-30)

## 1. 작업 범위와 원칙

이 문서는 기존 목 데이터 기반 화면을 유지하면서 같은 프론트엔드 서비스 인터페이스로 실제 서버 API를 선택해 사용할 수 있도록 정리한 결과를 설명한다.

- 작업 시작 시 Git 상태는 깨끗했다.
- 저장소의 추적 파일 297개와 전체 디렉터리 구조를 확인했다.
- node_modules, dist, dist-electron, release, 루트 .tmp 등 생성물·캐시·바이너리는 직접 분석 대상에서 제외했다.
- grad_server, data, docs, Dockerfile.backend, docker-compose.yml은 API 계약 파악을 위한 읽기 전용 자료로만 확인했다.
- 변경 파일은 grad_client 아래의 프론트엔드 코드, 테스트, 환경변수 예시, 이 문서로 제한했다.
- 실제 인증 비밀값이나 운영 키는 추가하지 않았다.

확인한 저장소의 주요 구조는 다음과 같다.

~~~
Graduation-Project/
├─ grad_client/                 # 변경 허용 범위: React/Vite/Electron 프론트엔드
│  ├─ electron/                # Electron main/preload
│  ├─ public/
│  ├─ renderer/
│  │  ├─ app/                  # Provider, router, layout
│  │  ├─ design-system/
│  │  └─ features/
│  │     ├─ auth/
│  │     ├─ org/
│  │     ├─ work-item/
│  │     └─ workspace/         # 도메인 타입, 데이터 서비스, 쿼리, 목 데이터
│  ├─ shared/
│  └─ tests/                   # 이번 작업에서 프론트 단위 테스트 추가
├─ grad_server/                # 읽기 전용: 실제 라우트/컨트롤러 확인
├─ data/                       # 읽기 전용: DB 스키마/열거형 확인
├─ docs/                       # 읽기 전용: API/화면 흐름 문서 확인
├─ docker-compose.yml          # 읽기 전용
└─ Dockerfile.backend          # 읽기 전용
~~~

## 2. 기존 프론트엔드 데이터 흐름 분석

### 2.1 목 데이터와 목 API 위치

- 원본 목 데이터: renderer/features/workspace/data/seed.ts
- 브라우저 저장소와 시드 복구: renderer/features/workspace/data/localStore.ts
- 인증 서비스: renderer/features/workspace/data/userService.ts
- 조직 서비스: renderer/features/workspace/data/orgService.ts
- 업무 서비스: renderer/features/workspace/data/workItemService.ts
- 화면용 조회/가공: renderer/features/workspace/queries 아래의 순수 조회 함수
- 요청·응답 및 도메인 타입: renderer/features/workspace/model/types.ts
- 인증 진입점: renderer/features/auth/api.ts

기존 “목 API”는 별도 HTTP 목 서버가 아니라 서비스 함수가 localStorage의 WorkspaceDatabase를 읽고 수정하는 구조다. 컴포넌트는 서비스 함수만 호출하므로, 서비스 내부의 분기만으로 목/서버 구현을 바꿀 수 있다.

### 2.2 호출과 데이터 가공

기존 읽기 흐름은 대체로 다음과 같다.

~~~
페이지·컴포넌트
  → getOrgSnapshot / readWorkspaceDb
  → localStorage의 WorkspaceDatabase
  → workspace/queries의 순수 조회·조합 함수
  → 화면 ViewModel
~~~

쓰기 흐름은 다음과 같다.

~~~
폼·페이지
  → userService / orgService / workItemService
  → 모드 선택
     ├─ mock: localStorage 데이터 검증·수정
     └─ server: HTTP 요청 → /context/init 재조회 → 서버 전용 캐시 교체
  → 공통 결과 타입
  → 화면 피드백 및 재조회
~~~

서비스 계층은 SignInRequest, CreateTopNodeRequest, CreateWorkItemRequest 같은 공통 도메인 요청 타입을 받는다. 서버 모드의 snake_case 전송 형식은 serverWorkspace.ts에서만 만든다. 화면과 쿼리는 서버 DTO를 직접 알지 못한다.

### 2.3 상태 관리와 캐싱

- Redux, React Query, SWR 같은 외부 전역 상태/서버 캐시 라이브러리는 사용하지 않는다.
- 도메인 데이터 캐시는 localStorage의 WorkspaceDatabase다.
- mock DB와 server DB는 별도 키를 사용한다.
- mock/session과 server/session도 별도 키를 사용한다.
- 서버 데이터가 갱신되면 workspaceCacheEvents.ts의 브라우저 이벤트로 AppShell을 다시 렌더링한다.
- 서버 모드의 user_id/work_item_id는 접근 가능한 캐시 범위와 무관한 UUID 기반 값으로 생성하고, 목 모드의 기존 순번 ID는 유지한다.
- 서버 세션이 있는 앱 시작 시 WorkspaceDataProvider가 /context/init을 호출해 캐시를 먼저 채운 뒤 라우트를 표시한다.
- 각 서버 변경 요청이 성공하면 전체 context를 다시 받아 캐시를 일관된 상태로 맞춘다.
- 서버 쓰기는 성공했지만 후속 context 재조회만 실패하면 쓰기를 실패로 되돌리지 않는다. 전역 복구 화면에서 같은 쓰기를 재제출하지 않고 context GET만 다시 시도한다.
- /context/sync용 구현은 준비되어 있지만 현재 자동 폴링, 포커스 재검증, 증분 동기화 스케줄러는 연결하지 않았다.

### 2.4 기존 로딩·오류·빈 데이터 처리

기존 화면에는 일부 제출 중 상태와 개별 빈 목록 문구가 있었지만, 실제 통신에 필요한 앱 시작 로딩/네트워크 실패 복구가 없었다. 또한 일부 제출은 연속 클릭을 막지 못했고 로그인 오류가 네트워크 원인을 숨길 수 있었다.

이번 변경으로 다음을 보완했다.

- 앱 시작 서버 hydration 로딩 화면
- 설정 오류, HTTP 오류, 네트워크 오류, 타임아웃, JSON 파싱 오류 표시
- 재시도 및 서버 세션 초기화 후 로그인 이동
- 라우트 로딩 및 예외 fallback
- 로그인, 조직 변경, 업무 생성·수정의 중복 제출 차단
- 제출 버튼 disabled 및 aria-busy
- 성공한 빈 context를 오류와 구분
- 잘못된 context 구조를 빈 데이터로 간주하지 않고 명시적으로 실패

## 3. Mock 모드와 Server 모드 구조

두 모드는 VITE_WORKSPACE_DATA_SOURCE 값으로 결정한다.

| 모드 | 값 | 원본 데이터 | 쓰기 방식 | 캐시 |
|---|---|---|---|---|
| Mock | mock | seed.ts 및 선택한 목 시나리오 | localStorage 직접 변경 | grad-client-mvp-db |
| Server | server | 실제 /context/init 응답 | 실제 API 호출 후 context 재조회 | grad-client-server-db |

공통 서비스 파일은 isServerDataSource()로 구현을 선택한다. 컴포넌트, 도메인 타입, 조회 함수는 두 모드에서 공유된다. 따라서 기존 목 화면 흐름을 삭제하지 않고 실제 서버 경로를 추가했다.

권한을 실제 변경 요청에 적용하는 UI는 모드별 서버 계약도 반영한다. Mock 모드의 기존 상속 관리 권한은 유지하고, Server 모드의 조직 변경은 현재 SQL과 같은 대상 노드의 직접 ADMIN/MANAGER 역할만 관리 권한으로 인정한다. Server 모드 업무 생성도 요청자와 담당자 모두 대상 노드에 직접 ADMIN/MANAGER/MEMBER 역할이 있는 선택지만 제공하며 VIEWER는 제외한다.

세션 저장소도 다음과 같이 분리했다.

| 용도 | 키 |
|---|---|
| Mock 사용자 세션 | grad-client-mock-session |
| Server 사용자 식별 세션 | grad-client-server-session-user |
| Server access token | grad-client-server-access-token |
| Server email | grad-client-server-email |

기존 grad-client-mvp-session 값은 값의 형태에 따라 해당 모드의 키로 한 번 이전한다. 이전 프론트가 사용하던 grad-client-server-refresh-token 값은 로그인 또는 로그아웃 시 제거한다. 현재 서버의 refresh token은 JSON이 아니라 HttpOnly 쿠키 계약이므로 프론트 localStorage에 저장하지 않는다. 서버 사용자 캐시에 비밀번호를 저장하지 않도록 UserRecord.password를 선택 필드로 바꿨다.

## 4. 환경변수와 모드 전환

### 4.1 환경변수

| 변수 | 허용값/예시 | 기본값 | 설명 |
|---|---|---|---|
| VITE_WORKSPACE_DATA_SOURCE | mock 또는 server | mock | 데이터 소스 선택 |
| VITE_WORKSPACE_API_BASE_URL | http://localhost:8080/api/v1 | http://localhost:8080/api/v1 | 실제 API 공통 URL |
| VITE_WORKSPACE_API_TIMEOUT_MS | 10000 | 10000 | 요청 타임아웃(ms), 0보다 커야 함 |
| VITE_WORKSPACE_MOCK_SCENARIO | default, empty, boundary, error | default | 목 데이터 시나리오 |

Server 모드에서는 Base URL이 http/https URL인지 검사하고 마지막 슬래시를 제거한다. 모드, URL, 타임아웃이 잘못되면 앱의 서버 데이터 gate에서 설정 오류로 표시한다. Mock 모드는 사용하지 않는 API URL/timeout 오타의 영향을 받지 않으며, 잘못된 모드 값만 오류로 처리한다. Vite 변수는 빌드 시 번들에 포함되므로 비밀 키를 넣으면 안 된다.

안전한 예시는 .env.example에 있으며, 실행별 기본값은 .env.mock과 .env.server에 분리했다.

### 4.2 Mock 모드 실행

~~~
cd grad_client
npm run dev:mock
~~~

기본 시나리오의 데모 계정:

- 이메일: backend.lead@team404.dev
- 비밀번호: team404-demo

빈 화면, 경계값 또는 오류 fallback을 확인하려면 .env.mock의 VITE_WORKSPACE_MOCK_SCENARIO를 각각 empty, boundary, error로 바꾼 후 다시 실행한다. error는 의도적인 목 데이터 예외를 발생시켜 라우트 오류 화면을 확인한다. 데이터 시나리오가 바뀌면 datasetId/seedVersion 비교를 통해 해당 목 DB가 새 시나리오로 초기화된다.

목 모드 번들 검증:

~~~
npm run build:bundle:mock
~~~

Electron 설치 패키지까지 만들 때는 npm run build:mock을 사용한다.

### 4.3 실제 서버 모드 실행

1. .env.server의 VITE_WORKSPACE_API_BASE_URL을 실행 중인 API 주소로 수정한다.
2. API 서버를 별도로 실행한다. 프론트엔드 작업에서는 서버 실행 설정을 변경하지 않았다.
3. 아래 명령으로 프론트엔드를 실행한다.

~~~
cd grad_client
npm run dev:server
~~~

4. 실제 서버에 등록된 계정으로 로그인한다.
5. 개발자 도구 Network에서 Base URL 아래 /users/login, /context/init 및 기능별 요청과 Authorization: Bearer 헤더를 확인한다.

서버 모드 번들 검증:

~~~
npm run build:bundle:server
~~~

Electron 설치 패키지까지 만들 때는 npm run build:server를 사용한다.

운영 주소, 토큰, 비밀번호, JWT secret 등은 저장소의 환경 파일에 기록하지 않는다. 현재 예시 파일에는 localhost URL과 공개 가능한 설정 이름만 있다.

## 5. 공통 API 클라이언트

renderer/features/workspace/data/server/apiClient.ts에서 다음을 공통 처리한다.

- Base URL과 상대 경로 결합
- JSON 요청 직렬화 및 Accept/Content-Type 헤더
- 저장된 access token의 Bearer 인증
- credentials: omit
- 204와 빈 body 처리
- 성공 응답의 JSON 파싱 실패 감지
- 서버 오류 body의 code/detail 보존과 4xx 공개 message 전달
- HTTP 5xx의 내부 message는 화면에 노출하지 않고 안전한 일반 오류 문구 사용
- 외부 AbortSignal과 요청 타임아웃
- 응답 헤더뿐 아니라 response body 읽기가 끝날 때까지 유지되는 타임아웃
- http, network, timeout, aborted, parse, configuration 오류 구분
- localStorage 접근이 차단된 환경의 안전한 fallback

서버의 status가 success/error인 공통 envelope는 apiTypes.ts에서 런타임 검사한다. HTTP 2xx라도 envelope가 맞지 않거나 context의 data가 배열이 아니면 오류로 처리한다.

현재 `credentials: omit`은 의도적인 임시 설정이다. 체크인된 서버가 `Access-Control-Allow-Origin: *`을 사용하므로 곧바로 credentialed request로 바꾸면 브라우저 CORS 검증에 실패한다. 따라서 현 단계에서는 로그인 JSON의 access token만 사용하며, refresh 쿠키와 자동 토큰 갱신은 서버 CORS·쿠키 정책과 함께 후속 구현해야 한다.

## 6. API 엔드포인트와 프론트엔드 기능

저장소의 grad_server/controllers 아래 라우트와 docs/API_SPECIFICATION.md 및 docs/api 문서를 함께 대조했다. 2026-08-30 현재 HTTP 컨트롤러의 공통 prefix는 /api이며, 실행 시 VITE_WORKSPACE_API_BASE_URL도 이 prefix를 포함해야 한다. 알림 WebSocket의 /api/v1 경로는 별도이며 이 프론트 연동 범위에 포함하지 않았다.

아래 경로는 VITE_WORKSPACE_API_BASE_URL 뒤에 붙는다.

| 프론트 기능 | 메서드/경로 | 주요 요청 필드 | 처리 |
|---|---|---|---|
| 회원가입 | POST /users | user_id, email, name, password | 성공 후 로그인 |
| 로그인 | POST /users/login | email, password | JSON access_token 저장 후 context 초기화; HttpOnly refresh 쿠키는 현재 미사용 |
| 토큰 갱신 | POST /users/refresh | refresh_token HttpOnly 쿠키 | 서버에는 구현되어 있으나 credentialed CORS가 준비될 때까지 프론트 자동 갱신 미연결 |
| 초기 데이터 | GET /context/init | 없음 | 응답 정규화 후 서버 캐시 교체 |
| 증분 데이터 | GET /context/sync?last_synced_at=... | 마지막 동기화 시각 | 정규화 후 캐시 병합; 자동 호출은 아직 미연결 |
| 최상위 조직 생성 | POST /org/topNodes | node_type, name, role_name | 성공 후 전체 context 재조회 |
| 하위 조직 생성 | POST /org/subNodes | node_type, parent_node_id, name, email, role_name | 성공 후 전체 context 재조회 |
| 조직 수정 | PATCH /org/nodes | node_id, name, node_type | 서버가 누락값을 빈 문자열로 덮으므로 두 필드를 항상 함께 전송한 뒤 전체 context 재조회 |
| 역할 추가 | POST /roles | email, node_id, role_name | 성공 후 전체 context 재조회 |
| 역할 수정 | PATCH /roles | email, node_id, role_name | 성공 후 전체 context 재조회 |
| 업무 생성 | POST /workItems | work_item_id, owner_node_id, owner_user_email, title 및 상세 필드 | 성공 후 전체 context 재조회 |
| 업무 수정 | PATCH /workItems | work_item_id와 변경된 상세 필드 | 성공 후 전체 context 재조회 |

서버가 생성 요청에서 새 ID를 안정적으로 반환하지 않는 현재 계약 때문에 조직/역할 생성 결과의 임시 ID는 화면 이동 판단에 사용하지 않고 context 재조회 결과를 기준으로 한다.

users.user_id와 work_items.work_item_id는 서버 DB의 전역 문자열 기본키다. 서버에 ID 발급 endpoint가 없으므로 server 모드에서는 각각 U-{UUID}, WI-{UUID} 형식으로 생성한다. 두 값 모두 현재 VARCHAR(50) 제한 안에 들어간다. mock 모드에서는 기존 U-{순번}, WI-{순번}을 그대로 쓴다.

업무 가져오기(claim)는 목 모드에서는 유지되지만, 현재 서버에는 담당자 변경 계약이 없어 서버 모드에서 명시적인 미지원 오류를 반환한다. 존재하지 않는 서버 경로를 임의로 호출하지 않는다.

## 7. 요청·응답 타입과 변환 방식

### 7.1 계층 분리

- model/types.ts: 화면과 목/서버 서비스가 공유하는 도메인 타입
- server/apiTypes.ts: 실제 전송 envelope와 context DTO
- server/contextAdapter.ts: 서버 DTO를 WorkspaceDatabase로 정규화
- server/serverWorkspace.ts: 도메인 요청을 서버 snake_case payload로 변환
- queries/serverWorkItemCreateContract.ts: 서버 SQL의 직접 역할 기반 업무 생성 선택지 계산

RoleName에는 서버 DB 열거형과 맞추기 위해 VIEWER를 추가했고 역할 선택 UI에서도 사용할 수 있게 했다.

로그인 성공 응답은 `{ status: "success", access_token: string }`으로 해석한다. `getServerLoginAccessToken`이 status, 문자열 자료형, 공백 토큰을 검사하며 JSON `refresh_token`은 요구하지 않는다. 서버가 발급하는 refresh token은 `Set-Cookie`의 HttpOnly 쿠키이므로 화면 DTO나 localStorage 모델에 포함하지 않는다.

### 7.2 실제 compact context 변환

현재 서버 ContextController는 NODE, ROLE, WORK_ITEM, AUTHORITY, MENTION을 한 data 배열에 담는 평면 다형 구조를 반환한다. USER 및 과거 compact 필드도 프론트 호환 범위에 포함한다.

| 서버 type | compact 필드 해석 | 프론트 도메인 |
|---|---|---|
| NODE | id, node_type, parent_id, title, extra_info(path) | OrganizationNodeRecord |
| ROLE | id, parent_id(node id), title(user email), status(role) | RoleAssignmentRecord와 이메일 기반 UserRecord |
| WORK_ITEM | id, parent_id(owner node), title, status, priority, extra_info(parent work item) | WorkItemRecord |
| USER | 문서화된 확장 응답에 존재할 경우 식별 정보 사용 | UserRecord |
| AUTHORITY | id, node_id, role, authority(24비트 문자열) | 알려진 서버 권한 정책으로 수용하되 현재 WorkspaceDatabase에는 저장하지 않음 |
| MENTION | id, comment_id, work_item_id, message, is_read | 알려진 알림 메타데이터로 수용하되 현재 알림 도메인이 없어 저장하지 않음 |

문서에 있는 확장 필드 owner_node_id, owner_user_id/email, description, weight, progress, start_date, due_date, created_at 등도 함께 지원한다. 서버가 실제로 보내면 손실 없이 도메인 레코드에 반영한다.

AUTHORITY는 사용자 역할 배정인 ROLE과 달리 노드별 역할의 권한 비트 정책이므로 RoleAssignmentRecord로 변환하지 않는다. AUTHORITY와 MENTION 때문에 관련 없는 노드·역할·업무 hydration 전체가 실패하지 않도록 알려진 비워크스페이스 항목으로 분류한다. 알 수 없는 새 type은 기존처럼 normalization issue로 처리해 계약 변경을 조용히 숨기지 않는다.

compact 응답만 왔을 때 복원할 수 없는 값은 다음처럼 보수적으로 처리한다.

- 업무 담당 사용자를 현재 로그인 사용자로 추측하지 않고 server-owner-unknown / “담당자 미확인”으로 표시한다. 캐시 참조 무결성을 위해 예약 도메인인 unknown-owner@local.invalid를 내부 식별 이메일로 사용한다.
- expanded 응답이 owner_user_id만 주고 이메일을 생략하면 해당 ID 기반 사용자를 이메일 없이 서버 캐시에 보존한다.
- description은 빈 문자열
- weight는 1
- progress는 0
- startDate/dueDate는 없음
- createdAt은 updated_at, 그것도 없으면 정규화 시각
- 로그인 사용자는 context가 비어 있어도 이메일 기반 최소 UserRecord로 유지

이 기본값은 화면 표시와 공통 조회를 위한 값이며 서버의 실제 저장값으로 간주하지 않는다. 업무 편집은 최초 폼과 비교해 사용자가 실제로 바꾼 필드만 PATCH한다. 따라서 compact 응답에 없던 description, weight, progress, start/due date가 제목 수정만으로 기본값에 덮어써지지 않는다. Server 모드에서는 계약이 없는 담당자 변경을 읽기 전용으로 잠그고, compact 응답에 없는 카테고리/마감일을 기존 업무 편집의 필수 입력으로 강제하지 않는다.

/context/sync처럼 일부 변경 항목만 오는 경우에는 현재 서버 캐시를 참조 컨텍스트로 전달한다. 변경 batch 안에 노드나 상위 업무가 없더라도 기존 캐시에 존재하면 정상 참조로 인정하고, sync 응답에서 생략된 업무 상세값은 기존 캐시 값을 유지한다.

필수 식별자, 참조, 항목 구조가 잘못된 경우 normalization issue를 만들고 load/sync를 실패시킨다. 이 방식으로 잘못된 서버 응답이 정상적인 빈 상태로 보이는 것을 막는다.

정규화 결과는 localStorage에 저장한 뒤 다시 읽을 때도 같은 참조를 유지한다. compact의 미확인 담당자와 expanded의 이메일 없는 ID-only 담당자 모두 adapter→JSON 직렬화→서버 캐시 정규화 왕복 테스트로 업무가 유실되지 않는지 검증한다.

## 8. 목 데이터 점검과 변경

기존 default 시드는 삭제하거나 축소하지 않았다.

- 사용자 128명
- 조직 노드 26개
- 역할 147개
- 업무 18개
- 사용자 ID/이메일, 노드 ID, 역할 ID, 업무 ID 중복 없음
- 역할의 사용자/노드 참조 유효
- 조직 parent/path 참조 유효
- 업무 담당자/노드/상위 업무 참조 유효
- 우선순위 1~5, 진행률 0~100, 음수가 아닌 weight
- 시작일이 있는 경우 시작일이 마감일보다 늦지 않음

수정·추가·삭제 내역:

| 구분 | 내용 | 이유 |
|---|---|---|
| 유지 | seed.ts의 기존 default 레코드 전체 | 기존 목 테스트와 화면 동작 보존 |
| 추가 | empty 시나리오 | 로그인 가능한 사용자만 남기고 조직/역할/업무가 없는 빈 화면 검증 |
| 추가 | boundary 시나리오 | 우선순위 1/5, weight 0, 진행률 0/100, 선택 날짜 없음, 시작일=마감일 검증 |
| 추가 | error 시나리오 | 의도적인 목 데이터 예외로 프론트 오류 fallback 검증 |
| 추가 | VIEWER 역할 값 | 실제 DB/서버 열거형과 공통 타입 일치 |
| 수정 | UserRecord.password를 선택 필드로 변경 | 서버 세션 사용자 캐시에 평문 비밀번호를 만들거나 저장하지 않기 위함 |
| 삭제 | 없음 | 사용되지 않거나 잘못된 기존 시드 레코드는 무결성 검사에서 발견되지 않음 |

목/서버 DB와 세션 키를 분리했으므로 server 모드 테스트가 기존 mock 데이터를 덮어쓰지 않는다.

## 9. UI 상태 처리

- WorkspaceDataProvider가 server 세션이 있을 때 초기 context 요청을 완료하기 전 화면 데이터 접근을 막는다.
- React StrictMode의 초기 effect 중복 호출을 방지한다.
- 초기 요청 실패 화면에서 “다시 시도”와 “로그인으로 돌아가기”를 제공한다.
- 쓰기 성공 후 캐시 갱신 실패도 같은 복구 화면으로 전환하되, 이미 반영된 쓰기를 다시 제출하지 말라는 메시지를 표시한다.
- 회원가입 성공 후 자동 로그인만 실패하면 가입 폼에 남기지 않고 로그인 화면으로 이동해 중복 계정 생성 시도를 막는다.
- 로그인/회원가입은 server 모드에서 목 데모 진입 UI를 노출하지 않는다.
- 로그인은 서버가 전달한 메시지 또는 공통 네트워크 오류를 표시한다.
- 조직 변경은 ref 기반 요청 잠금으로 같은 이벤트 루프의 중복 요청까지 차단하고, 로그인·최상위 조직·업무 폼은 submitting 상태와 disabled 버튼으로 반복 제출을 막는다.
- Server 모드 조직 변경은 대상 노드의 직접 ADMIN/MANAGER만 활성화한다. 하위 조직 관리자와 역할 대상은 이메일을 직접 입력할 수 있고, 현재 캐시 사용자는 datalist 자동완성 후보로 제공한다. Mock 모드는 기존 사용자 select를 유지한다.
- Server 모드 업무 생성은 직접 역할 계약에 맞는 노드와 담당자만 제공하며 생성 가능한 노드/담당자가 없으면 이유를 표시하고 제출을 차단한다.
- 조직 이름의 공백 입력과 업무 시작일보다 이른 마감일을 요청 전에 검증해 빈 이름 저장이나 DB 날짜 제약 오류를 막는다.
- 라우트 lazy loading 상태와 예상하지 못한 render/loader 오류 fallback을 제공한다.
- 기존 목록별 빈 상태 UI는 유지하며, server의 성공한 빈 context도 같은 공통 도메인 구조를 사용한다.

## 10. 변경된 파일과 목적

| 파일 | 변경 목적 |
|---|---|
| .env.example | 안전한 환경변수 이름과 기본 예시 |
| .env.mock | 목 실행 모드와 시나리오 기본값 |
| .env.server | 실제 서버 실행 모드와 Base URL/timeout 기본값 |
| package.json | mock/server 실행·번들·테스트·타입 검사 스크립트 |
| tsconfig.test.json | 외부 테스트 라이브러리 없이 node:test용 TS 컴파일 |
| renderer/vite-env.d.ts | 신규 Vite 환경변수 타입 |
| renderer/app/providers.tsx | WorkspaceDataProvider 연결 |
| renderer/app/routes.tsx | lazy route loading과 error fallback |
| renderer/app/RouteState.module.css | 라우트 상태 화면 스타일 |
| renderer/app/layouts/AppShell.tsx | workspace cache 갱신 이벤트 반영 |
| renderer/features/auth/pages/LoginPage.tsx | 실제 오류/가입 완료 안내, 제출 잠금, server 모드 데모 숨김 |
| renderer/features/auth/pages/SignupPage.tsx | 제출 잠금, server 모드 데모 숨김, 가입 후 로그인 실패 분리 |
| renderer/features/org/components/AssignRoleForm.tsx | 비동기 pending/disabled 및 server 이메일 직접 입력+datalist |
| renderer/features/org/components/CreateSubNodeForm.tsx | 비동기 pending/disabled, 필수 이름, server 관리자 이메일 직접 입력+datalist |
| renderer/features/org/components/NodeEditForm.tsx | 비동기 pending/disabled와 필수 조직 이름 |
| renderer/features/org/components/UpdateRoleForm.tsx | 비동기 pending/disabled 전달 |
| renderer/features/org/hooks/useOrgManagement.ts | 서버 오류/입력 처리, 조직 변경 중복 요청 차단, server 직접 관리 역할 적용 |
| renderer/features/org/pages/OrgManagePage.tsx | pending/접근성 피드백과 모드별 이메일 입력 방식 연결 |
| renderer/features/org/pages/TopNodeSetupPage.tsx | 서버 요청 로딩·오류·중복 제출 처리 |
| renderer/features/work-item/pages/WorkItemCreatePage.tsx | 서버 생성 로딩·오류·권한 가용성·날짜 검증·중복 제출 처리 |
| renderer/features/work-item/pages/WorkItemEditPage.tsx | 서버 수정 상태/날짜 처리, 담당자 잠금, dirty-field PATCH |
| renderer/features/work-item/components/WorkItemCreateForm.tsx | 서버 미지원 category/owner, 편집 필수값, 제출 차단 상태 분리 |
| renderer/features/work-item/hooks/useWorkItemCreateForm.ts | Server 모드 업무 생성 직접 역할 계약을 composer에 적용 |
| renderer/features/work-item/model/workItemFormValidation.ts | 생성·편집 공통 시작일/마감일 순서 검증 |
| renderer/features/work-item/model/workItemUpdatePayload.ts | 업무 편집에서 실제 변경한 필드만 요청 payload로 생성 |
| renderer/features/workspace/data/WorkspaceDataProvider.tsx | 서버 초기 hydration, 재시도, 오류/로딩 gate |
| renderer/features/workspace/data/WorkspaceDataProvider.module.css | 초기 데이터 상태 UI 스타일 |
| renderer/features/workspace/data/workspaceCacheEvents.ts | 캐시 갱신과 쓰기 후 재조회 실패를 React에 전달 |
| renderer/features/workspace/data/localStore.ts | mock/server DB 분리, 목 시나리오 시드, server 이메일 없는 사용자 참조 보존 |
| renderer/features/workspace/data/session.ts | 모드별 세션 분리와 legacy 세션 이전 |
| renderer/features/workspace/data/userService.ts | server 사용자 ID는 UUID, mock 사용자 ID는 기존 순번으로 분리 |
| renderer/features/workspace/data/workItemService.ts | server 업무 ID는 UUID, mock 업무 ID는 기존 순번으로 분리 |
| renderer/features/workspace/data/mockScenario.ts | default/empty/boundary 목 데이터 생성 |
| renderer/features/workspace/data/server/workspaceMode.ts | 모드, Base URL, timeout 파싱·검증 |
| renderer/features/workspace/data/server/apiClient.ts | 공통 fetch, 인증, timeout, 오류 분류 |
| renderer/features/workspace/data/server/apiTypes.ts | 전송 DTO와 응답 envelope 및 access-token-only 로그인 응답 런타임 검사 |
| renderer/features/workspace/data/server/contextAdapter.ts | compact/확장 context의 도메인 정규화 |
| renderer/features/workspace/data/server/serverId.ts | DB 길이 안의 UUID 기반 server entity ID 생성 |
| renderer/features/workspace/data/server/serverWorkspace.ts | 실제 endpoint 호출과 payload 변환, 캐시 갱신 |
| renderer/features/workspace/data/workspaceMode.ts | 기존 import 경로에서 server 모드 설정 재노출 |
| renderer/features/workspace/model/types.ts | VIEWER 및 비밀번호 없는 서버 사용자 지원 |
| renderer/features/workspace/model/options.ts | VIEWER 선택 옵션 |
| renderer/features/workspace/queries/selectedNodeDetail.ts | Server 모드 조직 변경의 직접 ADMIN/MANAGER 권한 계산 |
| renderer/features/workspace/queries/workItemComposer.ts | 모드별 업무 생성 노드·담당자·상위 업무 후보 계산 |
| renderer/features/workspace/queries/serverWorkItemCreateContract.ts | server 업무 생성 직접 역할 계약의 순수 필터 |
| tests/all.test.ts | 프론트 단위 테스트 진입점 |
| tests/apiClient.test.ts | URL/JSON/204/HTTP/parse/network/body timeout/5xx 정보 노출 방지 검증 |
| tests/apiTypes.test.ts | JSON refresh token 없이 access token만 반환하는 로그인 성공 계약과 잘못된 토큰 검증 |
| tests/contextAdapter.test.ts | compact/확장/빈/잘못된 context, AUTHORITY/MENTION 호환 및 partial sync 검증 |
| tests/localStore.test.ts | compact 미확인 담당자와 expanded ID-only 담당자의 캐시 왕복 보존 검증 |
| tests/mockScenario.test.ts | 기본 시드 무결성 및 empty/boundary/error 검증 |
| tests/serverId.test.ts | server UUID 형식, 충돌 방지 특성, DB 길이 제한 검증 |
| tests/serverWorkItemCreateContract.test.ts | server 업무 생성의 직접 역할 및 VIEWER 제외 계약 검증 |
| tests/workspaceMode.test.ts | mock 설정 격리와 server URL/timeout 검증 |
| tests/workItemFormValidation.test.ts | 시작일/마감일 경계와 역전 검증 |
| tests/workItemUpdatePayload.test.ts | compact 기본값이 수정 요청으로 역전송되지 않는지 검증 |
| FRONTEND_API_INTEGRATION.md | 분석, 실행법, 검증, 계약 차이와 TODO 기록 |

기존 renderer/features/workspace/data/apiClient.ts, serverWorkspace.ts, workspaceMode.ts는 외부 import 호환을 위한 재노출 파일로 유지했다.

## 11. 테스트와 검증

### 11.1 작업 전 기준선

변경 전 다음을 실행해 모두 통과한 것을 확인했다.

| 명령 | 결과 |
|---|---|
| npm run typecheck | 통과 |
| npm run lint | 통과 |
| npm run build:bundle | 통과 |

기존 package.json에는 test 스크립트와 테스트 파일이 없었다.

### 11.2 작업 후 결과

| 명령 | 결과 |
|---|---|
| npm run typecheck | 통과 |
| npm run lint | 통과, warning 0 |
| npm test | 통과, 24개 테스트 |
| npm run build:bundle:mock | 통과, renderer/main/preload 번들 생성 |
| npm run build:bundle:server | 통과, renderer/main/preload 번들 생성 |
| mock 번들 Vite preview | 통과, http://127.0.0.1:4173/ HTTP 200 및 React root/asset script 확인 |
| server 번들 Vite preview | 통과, http://127.0.0.1:4174/ HTTP 200 및 React root/asset script 확인 |
| server 산출물 설정 검사 | 통과, 기본 Base URL과 /context/init 호출 경로가 renderer 번들에 포함됨 |
| 127.0.0.1:8080 API TCP 확인 | 연결 실패, 실제 로컬 API 서버 미실행으로 live 요청 검증 불가 |
| npm run dev:mock -- --help | 통과, mock 실행 스크립트 확인 |
| npm run dev:server -- --help | 통과, server 실행 스크립트 확인 |
| npm run build | TypeScript와 Vite renderer/main/preload는 통과, Electron installer 패키징 단계는 환경 문제로 중단 |
| git diff --check | 공백 오류 없음; Git의 LF→CRLF 안내만 발생 |
| 서버/DB 범위 diff 검사 | grad_server, data, backend Docker/compose, docs 변경 없음 |

npm run build의 마지막 electron-builder 단계는 Windows의 사용자 AppData 캐시 권한을 허용해 다시 실행해도 winCodeSign 압축 해제 중 심볼릭 링크 생성 권한이 없어 실패했다. 이는 TypeScript 또는 프론트 번들 오류가 아니며, Windows 개발자 모드/심볼릭 링크 권한이 있는 로컬 환경에서 npm run build로 재확인해야 한다. 앱 아이콘이 설정되지 않아 기본 Electron 아이콘을 쓴다는 기존 패키징 경고도 함께 확인됐다.

로컬 번들의 정적 제공 경로는 두 모드 모두 HTTP로 확인했다. 다만 이 작업 환경의 앱 내 브라우저 런타임에는 사용 가능한 브라우저 인스턴스가 없어 클릭·입력·화면 캡처 기반 UI 자동 검증은 수행할 수 없었다. 아래 실제 서버 확인 절차와 함께 Electron 또는 일반 브라우저에서 로그인, 빈 화면, 제출 중 비활성화, 오류 후 재시도 동작을 직접 확인해야 한다.

### 11.3 실제 서버에서 직접 확인해야 하는 절차

이 작업 환경에서는 실행 중인 API 주소, 서버 계정, 서버 런타임 환경변수가 제공되지 않아 live end-to-end 요청은 수행하지 못했다. 기본 예시 주소의 127.0.0.1:8080 TCP 연결도 실패해 로컬 API 서버가 실행 중이지 않음을 확인했다. 숨겨진 성공으로 기록하지 않는다.

사용자 확인 절차:

1. 실제 서버의 외부 접근 URL과 /api/v1 prefix를 확인한다.
2. .env.server의 Base URL을 맞춘다.
3. npm run dev:server를 실행한다.
4. 회원가입 또는 실제 계정 로그인을 수행한다.
5. /context/init의 HTTP 상태, JSON envelope, data 배열을 확인한다.
6. 조직 생성/수정, 역할 생성/수정, 업무 생성/수정을 각각 한 번 수행한다.
7. 각 변경 뒤 /context/init이 재호출되고 화면에 결과가 반영되는지 확인한다.
8. 네트워크 차단, 401, 500, 빈 context를 각각 확인한다.

### 11.4 access-token-only 로그인 보정 검증 (2026-08-30)

서버 성공 응답에는 JSON `access_token`만 있고 `refresh_token`은 HttpOnly 쿠키로 오는 현재 계약에 맞춰 프론트 로그인 판정을 보정했다.

| 명령 | 결과 |
|---|---|
| npm test | 통과, 26개 테스트 |
| npm run typecheck | 실패, 기존 WorkItemEditPage.tsx의 미사용 변수 1개와 누락된 함수 참조 2개; 이번 로그인 변경 파일의 테스트용 TypeScript 컴파일은 통과 |
| npm run lint | 실패, 기존 WorkItemEditPage.tsx의 isServerMode 미사용 오류 1개 |
| npm run build:bundle:mock / build:bundle:server | 둘 다 선행 tsc에서 위 기존 WorkItemEditPage.tsx 오류로 중단 |
| npx vite build --mode mock / server | 둘 다 통과, renderer/main/preload 번들 생성 |

실계정 비밀번호를 작업 환경에 제공하거나 저장하지 않았으므로 실제 로그인 재현은 수행하지 않았다. 사용자는 `npm run dev:server`로 실행한 뒤 로그인하고, Network에서 `POST /api/users/login` 다음 `GET /api/context/init`이 호출되며 두 번째 요청에 `Authorization: Bearer ...`가 포함되는지 확인해야 한다. 로그인 다음에 새 오류가 표시되면 인증 판정이 아니라 `/context/init` 응답·정규화 단계로 구분해 진단한다.

### 11.5 AUTHORITY/MENTION 컨텍스트 호환 보정 (2026-08-30)

서버와 API 문서가 정상 응답으로 정의한 AUTHORITY를 프론트가 미지원 type으로 거부하던 문제를 수정했다. 같은 초기 응답에 포함될 수 있는 MENTION도 알려진 비워크스페이스 메타데이터로 함께 수용한다.

| 명령 | 결과 |
|---|---|
| npm test | 통과, 27개 테스트; AUTHORITY/MENTION 포함 context 회귀 테스트 통과 |
| npm run typecheck / npm run lint | 기존 WorkItemEditPage.tsx 오류가 남아 있어 전체 검증은 계속 중단됨 |
| npx vite build --mode server | 통과, renderer/main/preload 번들 생성 |

실제 서버 계정으로 다시 로그인한 뒤 `/api/context/init`에 AUTHORITY가 포함되어도 워크스페이스 화면으로 진입하는지 확인해야 한다. 이 환경에서는 서버에 재접속할 수 없어 live 응답 검증은 수행하지 못했다.

## 12. 제약사항, 가정, 미해결 항목과 TODO

### 12.1 프론트엔드 제약과 TODO

- 서버의 refresh_token은 HttpOnly 쿠키이고 `/users/refresh`도 존재하지만, 프론트 요청은 현재 `credentials: omit`이라 자동 갱신하지 않는다. access token 만료 시 재로그인이 필요하다.
- AUTHORITY와 MENTION은 현재 workspace 화면 모델에 저장하지 않는다. 권한 비트 기반 UI 제어 및 알림 UI를 구현할 때 전용 도메인·캐시·동기화 계층이 필요하다.
- /context/sync 구현은 있으나 삭제 tombstone이 없는 현재 응답으로는 안전한 삭제 병합을 보장할 수 없어 자동 동기화에 연결하지 않았다.
- 업무 담당자 변경/claim API가 없어 서버 모드에서는 해당 동작을 차단한다.
- 역할/하위 조직 대상 이메일은 직접 입력할 수 있지만 사용자 검색 endpoint는 없다. datalist에는 현재 context에서 알 수 있는 사용자만 표시되며, 신규 이메일의 가입 여부는 제출 후 서버 응답으로 확인한다.
- 서버 캐시와 access token은 현재 localStorage 기반이다. 장기적으로 access token도 Electron의 더 안전한 저장소 또는 서버의 HttpOnly cookie 정책을 검토해야 한다.
- 현재는 시작 시 hydration과 변경 후 전체 재조회 방식이다. 서버 계약이 안정되면 query cache, retry/backoff, focus revalidation을 검토할 수 있다.

### 12.2 서버 또는 백엔드 측 확인이 필요한 사항

아래는 읽기 전용 조사에서 확인했으며 프론트엔드에서 임의로 고치지 않았다.

1. 실제 ContextController compact 응답에는 업무 owner 사용자, description, weight, progress, start/due date, created_at이 없다. 화면에 필요한 전체 필드를 반환할지 계약 확정이 필요하다.
2. 문서의 context 확장 응답과 실제 컨트롤러 응답의 필드명·중첩 구조가 다르다.
3. 현재 HTTP 컨트롤러 prefix는 /api이지만 일부 기존 문서·프론트 fallback은 /api/v1을 전제로 한다. 배포 API의 최종 prefix를 명세에 고정해야 한다.
4. HttpOnly refresh 쿠키 기반 갱신을 사용하려면 서버가 `Access-Control-Allow-Origin`을 정확한 프론트 Origin으로 제한하고 `Access-Control-Allow-Credentials: true`를 추가해야 한다. Electron/localhost와 원격 서버 조합에서 `SameSite=Strict`, `Secure`, Origin 정책도 함께 확정해야 한다.
5. context sync에 삭제 tombstone이 없어 삭제 전파 방식이 불명확하다.
6. 업무 담당자 변경/claim 및 사용자 검색·조회 계약이 확인되지 않는다. 조직/역할 endpoint의 이메일 직접 입력은 지원하지만 사전 사용자 검색은 할 수 없다.
7. 잘못된 JWT가 401 대신 500으로 처리될 가능성이 있어 인증 오류 규약 확인이 필요하다.
8. 조직 PATCH 응답 생성 시점과 extra_info 오타(etra_info)로 보이는 서버 코드 확인이 필요하다.
9. main.cc는 JWT_SECRET을 `custom_config.jwt_secret`에 쓰지만 AuthController/JwtFilter는 `custom_config.app.jwt_secret`을 읽는다. 환경변수 secret이 실제 토큰 발급·검증에 반영되는지 서버 측 확인이 필요하다.
10. 서버 포트는 Docker compose의 SERVER_PORT 매핑과 컨테이너 8080 외에 체크인된 단일 실행 설정으로 확정할 수 없었다.
11. 역할 열거형 VIEWER의 실제 권한 의미와 hidden 필드 사용 여부를 명세에 반영할 필요가 있다.
12. 업무 수정 SQL은 빈 description/date를 기존 값 유지로 해석하므로 화면에서 값을 완전히 지우는 계약이 필요한지 확인해야 한다.
13. user_id/work_item_id 발급 책임을 장기적으로 서버가 맡을지, 현재 UUID 클라이언트 생성 규약을 공식화할지 확인해야 한다.
14. 현재 회원가입 서버/SQL은 입력 password를 password_hash 열에 그대로 저장하고 로그인도 평문 비교하는 것으로 보인다. 실제 사용자 비밀번호를 쓰기 전에 서버 측 단방향 해시와 안전한 검증을 반드시 구현·확인해야 한다.
15. 여러 컨트롤러의 DB 예외 응답은 내부 e.base().what()을 message로 반환하고 일부는 HTTP 5xx를 지정하지 않아 200 + error envelope가 될 수 있다. 프론트는 HTTP 5xx message를 숨기지만, 서버도 일관된 5xx 상태와 정제된 공개 메시지/별도 내부 로그로 고쳐야 한다.
16. 네트워크 단절이 서버 쓰기 처리 직후 응답 수신 전에 발생하면 프론트만으로 커밋 여부를 확정할 수 없다. 생성/변경 endpoint에 idempotency key 또는 작업 상태 조회 계약이 필요하다.
17. 현재 context에는 USER의 user_id/name도 없어 가입 시 입력한 표시명이 로그인 후 이메일 local-part 기반 이름으로 대체된다. 사용자 식별자와 표시명 조회 계약이 필요하다.
18. 업무 category는 현재 프론트의 기존 정적 태그 표현에만 있고 POST/PATCH/DB 계약에는 없다. Server 모드에서는 저장되는 값처럼 보이지 않도록 비활성화했으며, 실제 저장 기능이 필요하면 서버 필드와 응답 계약을 추가해야 한다.
19. 현재 조직/역할/업무 생성 SQL은 상위 노드의 상속 역할이 아니라 대상 노드의 직접 역할을 검사한다. 프론트 Server 모드는 이 동작에 맞췄지만, 제품 정책이 상속 권한을 의도했다면 서버 권한 규칙과 응답 명세를 함께 변경해야 한다.
20. PATCH /org/nodes는 이름/유형 중 하나가 누락되면 컨트롤러가 빈 문자열을 채워 SQL에서 기존 값을 덮는다. 프론트는 두 필드를 필수 공통 요청 타입으로 만들고 항상 함께 보내지만, 서버에서도 부분 PATCH 또는 full update 중 하나로 계약을 명확히 해야 한다.
21. 프론트의 현재 버튼 노출 권한은 역할명 중심이며 서버의 AUTHORITY 24비트 정책을 직접 소비하지 않는다. 커스텀 role_authorities를 허용할 경우 권한 상수·상속·DENY를 포함한 공개 계약이 필요하다.
22. MENTION 초기/동기화 응답은 확인했지만 현재 프론트 알림 도메인과 삭제·읽음 병합 규칙이 없다. 알림 기능 구현 전 응답 및 갱신 계약을 확정해야 한다.

## 13. 변경 범위 확인

이번 작업에서는 다음 항목을 수정·추가·삭제하지 않았다.

- grad_server의 백엔드 코드
- data의 DB 코드 및 설정
- API 서버 코드와 서버 환경설정
- 스키마 및 마이그레이션
- Dockerfile.backend, docker-compose.yml 및 기타 배포·인프라 코드
- 기존 루트 docs 문서

모든 소스 변경은 grad_client 내부의 프론트엔드 코드, 프론트엔드 전용 테스트·환경 예시, 이 문서에만 있다.
