# 🚀 Axis
> 조직·업무·일정·소통·코드 협업을 하나의 흐름으로 연결한 통합 협업 플랫폼입니다.<br>
> 무한 확장형 계층 구조와 역할 기반 권한으로 팀별 공간과 업무를 유연하게 관리합니다.<br>
> GitHub·VSCode 실시간 편집을 연동해 기획부터 개발과 리뷰까지 끊김 없이 이어갑니다.


## 📌 프로젝트 소개 (Introduction)
- **개발 기간** : 2026.01.05 ~ 2026.10.28

- **팀명 / 팀원** : 팀명 / 심동준, 방희수, 박준현, 강민수

- **주요 기능** :
    - **계층형 워크스페이스**: 개인 공간부터 회사·부서·팀까지 하나의 트리로 관리하며 생성·이동·삭제·복구를 지원합니다.
    - **업무·일정 관리**: 프로젝트와 할 일을 계층형 업무로 관리하고 진행률 자동 집계, 타임라인, 반복 일정, 캘린더를 제공합니다.
    - **역할·권한 관리**: 워크스페이스별 역할과 세분화된 권한을 설정하고 상속·재정의 기반으로 접근을 통제합니다.
    - **채널·알림**: 워크스페이스 채널과 1:1 DM, 참여자 접속 상태, 활동 알림과 멘션을 제공합니다.
    - **파일·산출물 관리**: 워크스페이스와 업무에 파일을 첨부하고 다운로드하며 협업 산출물을 한곳에서 관리합니다.
    - **GitHub 연동**: 저장소 연결, 브랜치·Worktree 관리, 파일 탐색, 변경 상태 확인, Stage·Commit·Push, 커밋 그래프를 지원합니다.
    - **VSCode 실시간 협업**: Axis Share 확장으로 브랜치별 동시 편집, 원격 커서·선택 영역, 리뷰 데코레이션을 제공합니다.
    - **통합 대시보드**: 워크스페이스·업무·일정·활동 현황을 한 화면에서 확인합니다.


## 📂 디렉토리 구조 (Directory Structure)
```
Graduation-Project/
├── .github/               # Issue/PR 템플릿
├── assets/                # README용 이미지 및 시연 자료
├── data/                  # PostgreSQL 스키마, 함수, 트리거, 시드 SQL
├── deploy/                # Nginx, logrotate 등 배포 설정
├── docs/                  # API, 아키텍처, ERD, 설계 문서
├── grad_client/           # Electron 데스크톱 클라이언트
├── grad_collab/           # Yjs 기반 실시간 협업 서버
├── grad_server/           # C++ Drogon 백엔드 API 서버
├── grad_vscode/           # VSCode 확장 프로그램 Axis Share
├── tests/                 # 공용 테스트 디렉토리
├── uploads/               # 업로드 파일 저장 디렉토리
├── .clang-format          # C++ 코드 포맷 설정
├── .dockerignore          # Docker 빌드 제외 설정
├── .gitignore             # Git 관리 제외 설정
├── docker-compose.yml     # 전체 서비스 실행 구성
├── Dockerfile.backend     # 백엔드 실행 이미지
├── Dockerfile.backend.base # 백엔드 빌드 베이스 이미지
├── LICENSE                # MIT 라이선스
└── README.md              # 프로젝트 메인 설명서
```


## 🛠 기술 스택 (Tech Stack)
### 💻 Development

| 구분 | 기술 | 사용 목적 |
| :--- | :--- | :--- |
| Desktop Client | Electron 30, React 18, TypeScript, Vite | Windows 데스크톱 애플리케이션 및 렌더러 UI |
| Client UI | React Router 7, CSS Modules | 화면 라우팅과 디자인 시스템 기반 UI 구성 |
| Backend | C++17/20, Drogon | REST API, WebSocket, 인증 및 GitHub·Git 연동 |
| Realtime Collaboration | Node.js 20, TypeScript, Yjs, ws | CRDT 기반 실시간 문서 동기화와 Worktree 파일 반영 |
| VSCode Extension | TypeScript, VS Code API, Yjs, esbuild | Axis Share 사이드바, 브랜치·리뷰·실시간 협업 기능 |
| Build & Quality | CMake, npm, Vite, ESLint, TypeScript Compiler | 플랫폼별 빌드, 정적 검사 및 테스트 |

### ☁️ Infrastructure & DB

| 구분 | 기술 | 사용 목적 |
| :--- | :--- | :--- |
| Database | PostgreSQL 15, PL/pgSQL | 계층형 데이터, 함수·트리거 기반 무결성 및 권한 관리 |
| Container | Docker, Docker Compose | 데이터베이스·백엔드·협업 서버 통합 실행 |
| Web Server | Nginx | 리버스 프록시, TLS 종료 및 WebSocket 업그레이드 |
| Hosting | AWS EC2, Ubuntu | 운영 서버 호스팅 |
| TLS | Let's Encrypt, Certbot | HTTPS 인증서 발급 및 자동 갱신 |
| Storage | Docker Volume, 공유 볼륨 | DB 데이터, Git 저장소·Worktree, 업로드 파일 보관 |
| Mail | Resend | 회원가입 이메일 인증 및 비밀번호 재설정 메일 |
| External Integration | GitHub REST API, Webhook, PAT | 저장소 연동, Git 이벤트 수신 및 원격 Push |

### 🔗 Protocol & Security

| 구분 | 기술 | 사용 목적 |
| :--- | :--- | :--- |
| API | REST, JSON | 클라이언트·확장 프로그램과 서버 간 통신 |
| Realtime | WebSocket, WSS | 알림, 채널, Git 상태 및 문서 편집 실시간 동기화 |
| Git | Git CLI, Git Worktree | 저장소 Clone, 브랜치 격리, Commit·Push 처리 |
| Auth | JWT Access·Refresh Token | 사용자 인증과 세션 갱신 |
| Authorization | 32비트 비트마스크 권한 | 워크스페이스별 역할 및 세분화된 접근 제어 |
| Encryption | OpenSSL, PostgreSQL pgcrypto | 토큰·GitHub PAT 등 민감 정보 보호 |


## 🏗 시스템 아키텍처 (System Architecture)
전체 시스템 구성과 계층별 상세 설계는 [시스템 아키텍처 설계서](docs/ARCHITECTURE.md)에서 확인할 수 있습니다.

```mermaid
flowchart TB
    subgraph ClientTier ["클라이언트 계층 (Client Tier)"]
        subgraph DesktopApp ["AxisFlow 데스크톱 앱 (Electron + React)"]
            UI["Renderer (React + Vite + TailwindCSS)"]
            MainProc["Electron Main / Preload (IPC)"]
            Store["Local Cache / State Store"]
            UI <--> MainProc
            UI <--> Store
        end

        subgraph VSCodeExt ["VSCode Extension"]
            ExtCore["Extension Host (TypeScript)"]
            Sidebars["Tree / Sidebar Providers"]
            ExtCore <--> Sidebars
        end
    end

    subgraph GatewayTier ["인프라 및 프록시 (Nginx / Gateway)"]
        Nginx["Reverse Proxy (Nginx)"]
    end

    subgraph BackendTier ["백엔드 계층 (Backend Tier)"]
        subgraph DrogonServer ["메인 API & WebSocket 서버 (C++ Drogon)"]
            Controllers["Domain Controllers (Auth, Org, Work, Role, GitHub, Chat)"]
            Filters["Auth Filter (JWT, RateLimit)"]
            ServiceLayer["Business Logic & Git Coordinator"]
            DBPool["PostgreSQL Async Connection Pool"]
            Filters --> Controllers --> ServiceLayer --> DBPool
        end

        subgraph CollabServer ["실시간 문서 협업 서버 (Node.js + Yjs)"]
            YjsEngine["Y.Doc CRDT Sync Engine"]
            CollabWS["WebSocket Handler"]
            FileFlusher["Worktree File Flusher"]
            CollabWS <--> YjsEngine <--> FileFlusher
        end
    end

    subgraph DataTier ["데이터 & 파일 스토리지 (Data Tier)"]
        Postgres[("PostgreSQL 15 (DB & PL/pgSQL Functions)")]
        FileStorage[("Local / Shared Volume (Worktree & Uploads)")]
    end

    subgraph ExternalTier ["외부 연동 계층 (External Tier)"]
        GitHubAPI["GitHub REST / Git Server"]
        MailService["Resend / SMTP Mail Provider"]
    end

    %% Client to Gateway / Backend
    DesktopApp -->|"HTTPS / REST API (/api/*)"| Nginx
    DesktopApp -->|"WSS / Notification & Chat (/api/notification/ws, /api/chat/ws)"| Nginx
    DesktopApp -->|"WSS / Document Sync (/collab/*)"| Nginx
    VSCodeExt -->|"HTTPS / REST API & Handoff (/api/github/*)"| Nginx
    VSCodeExt -->|"WSS / Git Status WebSocket (/api/github/ws)"| Nginx

    Nginx -->|"Proxy Pass :8080"| DrogonServer
    Nginx -->|"Proxy Pass :3000"| CollabServer

    %% Backend to Internal
    DrogonServer <-->|"libpq Async"| Postgres
    DrogonServer <-->|"Ticket Validation & Event (/internal/collab/*)"| CollabServer
    DrogonServer -->|"Git CLI / Worktree Sync"| FileStorage
    CollabServer -->|"Shared Volume Read/Write"| FileStorage

    %% Backend to External
    DrogonServer -->|"HTTPS / Git Operations"| GitHubAPI
    DrogonServer -->|"HTTPS / Transactional Mail"| MailService
```


## 📺 주요 화면 및 시연 (Screenshots & Demo)
| 메인 화면 | 핵심 기능 실행 | 결과 화면 |
| :---: | :---: | :---: |
| 이미지 | 이미지 | 이미지 |


## ⚙️ 시작하기 (Getting Started)
### 📋 요구 사항 (Prerequisites)

### 🛠 빌드 및 실행 (Installation)


## 📝 협업 규칙 (Contribution Guidelines)
우리 팀의 효율적인 협업을 위해 다음 규칙을 준수합니다. 자세한 내용은 [CONTRIBUTING.md](.github/CONTRIBUTING.md)에서 확인하세요.

- **브랜치**: `main` <- `develop` <- `feature/기능명` 순으로 작업합니다.
- **커밋**: `태그: 설명` 형식을 유지합니다. (예: `Feat: 센서 데이터 수신 로직 구현`)
- **코드 스타일**: C++ Google Style Guide를 지향하며, 커밋 전 `Clang-Format`을 적용합니다.
- **PR**: 기능 완료 후 `develop` 브랜치로 PR을 날리고, 팀원의 리뷰를 거칩니다.


## 👥 팀원 역할 (Team Members)

| 이름 | 역할 | 담당 업무 | 이모지 |
| :--- | :--- | :--- | :---: |
| **심동준** | 팀장 (PM) |  | 👑 |
| **방희수** |  |  | 🧠 |
| **박준현** |  |  | ⚙️ |
| **강민수** |  |  | 🌱 |
