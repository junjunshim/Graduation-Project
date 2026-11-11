# Axis Share

**Axis Flow 워크스페이스의 원격 저장소를 VS Code에서 실시간으로 함께 편집하는 확장 프로그램입니다.**

Axis Share는 저장소를 각자 로컬에 복제해 따로 작업하는 대신, Axis Flow 서버의 저장소 작업 디렉터리에 여러 사용자가 같은 브랜치 단위로 접속해 파일을 편집하고 커밋합니다. 같은 브랜치에 접속한 사용자끼리만 편집 내용과 커서가 공유됩니다.

- Extension ID: `junjunshim.axis-share`
- Publisher: `junjunshim`
- VS Code: `1.110.0` 이상

## 주요 기능

- **브랜치 단위 실시간 편집**: 같은 브랜치의 사용자끼리 텍스트 변경을 즉시 공유합니다.
- **실시간 접속자 확인**: 저장소 전체 및 브랜치별 접속자와 각 사용자가 열어 둔 파일을 확인합니다.
- **원격 커서와 선택 영역**: 다른 사용자의 커서와 드래그 영역을 사용자별 색상으로 표시합니다.
- **리뷰 데코레이션**: 오타·문법·논리·기타·강조 데코레이션을 코드에 표시하고 사이드바에서 관리합니다.
- **게으른 파일 로딩**: 처음에는 디렉터리 구조만 받고, 파일을 열 때 내용을 가져옵니다.
- **Git 상태와 커밋**: 스테이징, 커밋, push, pull, reset, 파일 되돌리기와 브랜치별 변경 상태를 Changes 뷰에서 처리합니다.
- **내장 diff**: 작업 트리, 스테이징, 커밋, 원격 기준 변경을 VS Code 기본 diff 화면으로 확인합니다.
- **커밋 그래프**: 현재 브랜치의 커밋 흐름과 원격 위치를 보여 주며, 저장소 전체 그래프도 웹뷰로 열 수 있습니다.
- **AI CLI 연동**: Codex · Claude Code · Antigravity CLI를 현재 브랜치의 AI 전용 작업공간에서 사용할 수 있고, MCP로 Axis 상태·파일·diff를 읽고 안전하게 쓸 수 있습니다.
- **안전한 세션 연결**: 앱이 발급한 1회용 코드로 확장 전용 세션을 시작하며, GitHub 비밀번호나 PAT를 확장에 직접 입력하지 않습니다.

## 요구 사항

- Visual Studio Code `1.110.0` 이상
- Axis Flow 계정과 해당 워크스페이스의 저장소 접근 권한
- Axis Flow에서 GitHub 원격 저장소가 연결되어 있어야 함
- GitHub 작업 시 저장소 조회 권한과 편집 권한 필요
- 초기 연결을 위한 Axis Flow 데스크톱 앱
- 실시간 협업과 커밋/push를 위한 서버 네트워크 연결
- 커밋할 경우 `user.name`과 `user.email` 설정 필요
- AI CLI를 사용할 경우 Codex · Claude Code · Antigravity CLI 중 하나를 사용자 PC에 설치하고 로그인해야 함 (선택)

## 설치

### VS Code Marketplace

1. VS Code의 Extensions 뷰를 엽니다.
2. `Axis Share` 또는 `junjunshim.axis-share`를 검색합니다.
3. **Install**을 선택합니다.

CLI로 설치할 수도 있습니다.

```bash
code --install-extension junjunshim.axis-share
```

### VSIX 파일

배포된 VSIX 파일이 있다면 아래 명령으로 설치합니다.

```bash
code --install-extension axis-share-<version>.vsix
```

## 시작하기

1. Axis Flow 앱에서 원격 저장소를 연결합니다.
2. 워크스페이스의 GitHub 탭에서 **VSCode로 실시간 편집**을 선택합니다.
3. 운영체제가 `vscode://junjunshim.axis-share/auth?...` URI로 VS Code를 열면 연결을 허용합니다.
4. 확장이 1회용 코드를 세션 토큰으로 교환하고 저장소의 기본 브랜치를 엽니다.
5. 왼쪽 Activity Bar의 **Repository** 아이콘에서 파일 트리, 브랜치, 변경 상태를 확인합니다.

> Axis Share는 VS Code를 단독으로 실행했다고 이전 세션을 자동 복원하지 않습니다. 새 창에서 저장소를 사용하려면 Axis Flow 앱에서 다시 **VSCode로 실시간 편집**을 실행해야 합니다. 이 동작은 이전 연결 정보나 편집 상태가 의도치 않게 남는 것을 막기 위한 것입니다.

## 사이드바

| 뷰 | 설명 |
|:---|:---|
| **Repository** | 브랜치별 디렉터리·파일 트리, git 상태 배지, 브랜치 전환·생성·삭제, 파일 생성·이름 변경·삭제·경로 복사 |
| **Changes** | 현재 브랜치의 staged/modified/untracked 상태, 스테이징·해제, 되돌리기, 커밋, push, diff |
| **Graph** | 현재 브랜치의 커밋 목록과 원격 위치. 저장소 전체 그래프는 별도 웹뷰 탭으로 표시 |
| **Editing** | 저장소 전체 접속자 수와 브랜치별 사용자, 각 사용자가 열어 둔 파일 |
| **Reviews** | 오타·문법·논리·기타·강조 리뷰 데코레이션 목록과 이동·삭제·표시 전환 |
| **AI** | 설치된 AI CLI 감지, AI 전용 작업공간·MCP 브리지 상태, AI 터미널 실행·동기화·초기화 |

### Repository

- 처음에는 디렉터리와 파일 구조만 조회합니다.
- 파일을 열 때 서버에서 최신 내용을 가져옵니다.
- 파일과 디렉터리는 컨텍스트 메뉴에서 생성·이름 변경·삭제할 수 있습니다.
- 변경된 파일에는 `M`, 추가된 파일에는 `A`, 추적되지 않는 파일에는 `U`, 삭제된 파일에는 `D` 상태가 표시됩니다.
- 브랜치 피커에서 브랜치를 전환하거나 새 브랜치를 만들 수 있습니다.

### Changes

- 현재 브랜치의 작업 트리 상태를 실시간으로 반영합니다.
- 각 파일을 staged 또는 unstaged 상태로 전환할 수 있습니다.
- 수정 내용을 이전 상태로 되돌릴 수 있습니다.
- 커밋과 push는 분리되어 있습니다. 커밋 후 원하는 시점에 push합니다.
- 원격 변경은 pull로 병합하고, pull이 막히는 로컬 커밋은 reset으로 되돌릴 수 있습니다.
- 파일을 선택하면 VS Code 내장 diff가 열립니다.
- 다른 사용자가 상태를 바꾸거나 커밋하면 Changes 뷰도 갱신됩니다.

### Graph

- 현재 브랜치의 커밋을 시간 순서로 보여 줍니다.
- 로컬 HEAD와 원격 브랜치 위치를 함께 확인할 수 있습니다.
- 커밋을 펼쳐 변경된 파일을 보고 diff를 열 수 있습니다.
- 상단의 그래프 버튼으로 모든 브랜치와 태그를 포함한 저장소 전체 그래프를 웹뷰 탭에서 확인할 수 있습니다.

### Editing

- 저장소에 접속한 전체 사용자 수를 표시합니다.
- 접속자를 브랜치별로 묶어 보여 줍니다.
- 사용자 아래에서 해당 사용자가 현재 열어 둔 파일을 확인할 수 있습니다.
- 다른 사용자의 파일 항목을 선택해 같은 파일을 열 수 있습니다.

### Reviews

- 리뷰 데코레이션은 파일의 해당 위치에 인라인으로 표시됩니다.
- 데코레이션 목록에서 위치로 이동하거나 삭제할 수 있습니다.
- 데코레이션 표시 여부는 설정 또는 Reviews 뷰 상단 버튼으로 전환합니다.
- 리뷰는 같은 브랜치의 협업 사용자에게 공유됩니다.

### AI

- **AI 터미널 열기**는 현재 브랜치의 AI 전용 작업공간에서 터미널만 엽니다. CLI 명령은 사용자가 직접 입력합니다.
- AI 탭 트리에는 현재 세션·작업공간 상태와 MCP 설정 진입점만 표시합니다.
- **작업공간 동기화**는 최초에는 worktree 압축본(tar.gz)을 한 번 받고, 이후에는 서버 manifest와 로컬 캐시를 비교해 바뀐 파일만 다시 받습니다. AI가 직접 수정한 파일은 덮어쓰지 않습니다.
- AI가 디스크에서 직접 고친 파일은 잠시 뒤 자동으로 서버에 CAS 반영되고, 다른 사용자의 Changes·Repository 뷰에도 알림이 갑니다.
- 다른 사용자가 바꾼 파일은 제어 WebSocket 알림(`worktree_changed`·파일 생성/삭제/이동)으로 AI 작업공간에도 즉시 반영됩니다.
- **MCP 설정 보기**는 Codex·Claude에서는 `.axis/mcp.json`, Antigravity에서는 `~/.gemini/config/mcp_config.json`을 엽니다.
- **AI 작업공간 초기화**는 명령 팔레트에서 실행하며, 커밋하지 않은 AI 작업 내용까지 삭제합니다.
- **AI 세션 종료**는 AI 뷰 상단 툴바에서 AI 터미널과 MCP 브리지를 함께 종료합니다.

AI 작업공간은 현재 열린 저장소의 일반 편집 사본과 분리되어 `globalStorage/ai-workspace/repo-<id>/branch-<slug>`에 생성됩니다. 서버는 먼저 경로·크기·버전 토큰만 담은 manifest를 주고, 최초·대량 동기화는 worktree 전체를 tar.gz 한 번으로 내려받아 풉니다. 이후에는 `.axis/manifest.json` 캐시와 비교해 바뀐 파일만 개별 API로 받습니다. 압축은 전송량을 줄이는 용도이며 파일 수·크기·민감 파일 제외 규칙은 manifest와 같습니다. `.git`은 로컬 baseline 용도로만 새로 초기화합니다.

## 실시간 편집

- 실시간 공유 범위는 **저장소가 아니라 브랜치**입니다. 같은 저장소라도 서로 다른 브랜치에 있으면 편집 내용이 공유되지 않습니다.
- 다른 사용자의 커서와 선택 영역이 사용자별 색상으로 표시됩니다.
- 협업 연결이 끊기면 편집이 잠깁니다. 끊긴 동안 다른 사용자가 변경했을 수 있으므로 로컬 내용을 임의로 병합하지 않습니다.
- 다시 연결되면 열려 있던 파일을 서버 내용으로 다시 받아 동기화합니다.
- 편집 권한이 회수되면 해당 파일은 읽기 전용으로 전환됩니다.
- 연결 상태는 VS Code 하단 상태 표시줄에서 확인할 수 있습니다.

## AI CLI 연동

Axis Share는 AI 모델 API를 직접 호출하지 않습니다. 사용자가 설치하고 로그인한 CLI를 현재 브랜치의 전용 작업공간에서 실행하고, MCP를 통해 Axis의 최신 상태와 파일을 연결합니다.

### 지원 CLI

| CLI | 실행 명령 | 비고 |
|:---|:---|:---|
| Codex | `codex` | ChatGPT 로그인 또는 CLI 자체 인증 사용 |
| Claude Code | `claude` | Anthropic 계정 로그인은 CLI에서 수행 |
| Antigravity | `agy` | `~/.gemini/config/mcp_config.json`에 Axis MCP 서버를 등록 |

CLI가 `PATH`에 없으면 설정에서 실행 파일의 절대 경로를 지정합니다. Axis Share는 CLI를 자동 설치하거나 대신 로그인하지 않습니다.

### 작업공간과 MCP

AI 터미널을 열면 다음 파일이 생성됩니다.

```text
globalStorage/ai-workspace/repo-<id>/branch-<slug>/
  <branch snapshot>
  .git/                 # 로컬 baseline (원격과 연결되지 않음)
  .axis/context.md      # 브랜치·상태·접속자·Axis 규칙
  .axis/mcp.json        # MCP 브리지 설정
  .mcp.json             # Claude Code 프로젝트 설정
  .codex/config.toml    # Codex 프로젝트 설정
```

MCP 브리지는 `127.0.0.1`의 임의 포트에서만 열리고, 세션마다 새로 만든 시크릿으로 인증합니다. 브리지 접속 정보는 `globalStorage/ai-session.json`에 저장되며 세션을 종료하면 삭제됩니다.

Antigravity CLI(`agy`)는 프로젝트 로컬 MCP 설정을 읽지 않습니다. 따라서 AI 터미널을 열 때 `~/.gemini/config/mcp_config.json`의 `mcpServers.axis-share` 항목을 현재 저장소·브랜치 기준으로 갱신합니다. 기존의 다른 MCP 서버 항목은 유지됩니다.

### MCP 도구

| 도구 | 설명 |
|:---|:---|
| `axis_get_context` | 저장소·브랜치·사용자·상태·원격·접속자·Axis 규칙 |
| `axis_list_files` | AI 작업공간 파일 목록 |
| `axis_read_file` | 서버 작업 트리의 최신 파일 내용과 `content_hash` |
| `axis_get_status` | staged / modified / untracked 상태 |
| `axis_get_diff` | working 또는 staged 통합 diff |
| `axis_get_presence` | 브랜치별 접속자 |
| `axis_write_file` | `expected_hash` 기반 CAS 파일 쓰기 |
| `axis_delete_file` | `expected_hash` 기반 CAS 파일 삭제 |
| `axis_stage` | 파일 스테이징 |
| `axis_unstage` | 스테이징 해제 |

AI가 기존 파일을 덮어쓸 때는 반드시 `axis_read_file`이 돌려준 `content_hash`를 `expected_hash`로 보내야 합니다. 그 사이 다른 사용자가 파일을 바꿨다면 서버가 `P0816` 충돌을 반환하며, AI는 최신 내용을 다시 읽고 병합해야 합니다.

### 안전 정책

- `.env`, `.npmrc`, `.ssh`, 자격 증명 파일 등 비밀값이 들어가기 쉬운 파일은 작업공간 스냅샷에서 제외합니다.
- AI 작업공간의 `.git`은 로컬 baseline이며 GitHub 원격과 연결되지 않습니다.
- AI가 작업공간에서 파일을 직접 디스크에 수정·삭제하면 파일 감시자가 변경을 모아 서버에 CAS 로 반영합니다. 그 사이 다른 사용자가 같은 파일을 바꿨다면 덮어쓰지 않고 AI 뷰에 충돌 경고를 남깁니다.
- 자동 반영은 파일당 512KB 까지입니다. 더 큰 파일은 `axis_write_file` 로도 쓸 수 없으며, Axis Changes 에서 직접 처리해야 합니다.
- AI의 commit·push 도구는 제공하지 않습니다. 스테이징까지만 MCP 로 가능하고, 커밋과 push 는 Changes 뷰에서 사용자가 직접 수행합니다.
- AI가 연 터미널은 사용자 권한으로 실행되므로 작업공간 경로가 보안 경계가 되지 않습니다. 신뢰할 수 있는 CLI만 실행하세요.

## 커밋과 push

커밋을 만들려면 Changes 뷰 상단의 설정 버튼이나 명령 팔레트에서 **Axis Share: 커밋 사용자 설정**을 실행해 작성자 정보를 입력합니다.

| 설정 | 설명 |
|:---|:---|
| `axis-share.user.name` | 커밋에 기록할 작성자 이름 |
| `axis-share.user.email` | 커밋에 기록할 작성자 이메일. Axis Flow 계정 이메일과 일치해야 합니다. |

두 값이 모두 설정되어야 커밋 입력창이 표시됩니다. 커밋은 현재 브랜치의 서버 작업 디렉터리에서 만들어지며, push는 별도로 실행합니다.

### 원격 동기화와 되돌리기

- **Fetch**는 원격 추적 ref만 갱신하고 작업 트리는 바꾸지 않습니다.
- **Pull**은 fetch 후 현재 브랜치에 `origin/<branch>` 를 병합합니다. 커밋되지 않은 변경이 있으면 먼저 커밋하거나 되돌려야 합니다.
- 충돌이 나면 서버가 병합을 취소하므로 작업 트리에 충돌 상태가 남지 않습니다. 충돌 파일을 정리한 뒤 다시 pull하세요.
- **Reset**은 마지막 커밋 취소(`HEAD~1`) 또는 원격 기준 초기화(`origin/<branch>`)를 제공합니다.
- soft reset은 변경을 staged로, mixed reset은 작업 트리에 남기고, hard reset은 추적 파일의 변경을 버립니다. hard reset도 untracked 파일은 삭제하지 않습니다.
- 원격 기준 초기화는 로컬 커밋까지 버리므로 실행 전에 확인 창이 표시됩니다.

### Diff 종류

Axis Share는 서버에서 파일 내용을 받고 비교는 VS Code 내장 diff에 맡깁니다. 다음 비교를 지원합니다.

- 작업 트리와 `HEAD`
- 스테이징된 인덱스와 `HEAD`
- 스테이징 이후 작업 트리와 인덱스
- 커밋과 부모 커밋
- 원격 브랜치와 로컬 `HEAD`

## 브랜치 규칙

- 새 브랜치는 현재 작업 중인 로컬 브랜치를 기준으로 생성됩니다.
- 브랜치를 전환하면 Repository, Changes, Graph, Editing 뷰가 해당 브랜치 기준으로 다시 그려집니다.
- 기본 브랜치는 삭제할 수 없습니다.
- 삭제 요청자 외에 같은 브랜치에 접속한 사용자가 있으면 삭제가 차단됩니다.
- 커밋되지 않은 staged/modified/untracked 변경이 있으면 확인 후 강제 삭제할 수 있습니다.
- 브랜치가 삭제되면 그 브랜치에 있던 사용자는 기본 브랜치로 이동합니다.

## 설정

| 설정 | 기본값 | 설명 |
|:---|:---|:---|
| `axis-share.serverUrl` | `https://axisflow.team/api` | Axis Flow 서버 API 주소. 끝의 `/`는 자동 제거됩니다. |
| `axis-share.showDecorations` | `true` | 에디터에 리뷰 데코레이션을 표시합니다. 사이드바 목록에는 영향을 주지 않습니다. |
| `axis-share.user.name` | 빈 값 | 커밋 작성자 이름 |
| `axis-share.user.email` | 빈 값 | 커밋 작성자 이메일 |
| `axis-share.ai.enabled` | `true` | AI CLI 연동과 AI 뷰를 사용합니다. |
| `axis-share.ai.providers.codex.path` | 빈 값 | Codex CLI 절대 경로. 비우면 `PATH`에서 찾습니다. |
| `axis-share.ai.providers.claude.path` | 빈 값 | Claude Code CLI 절대 경로. 비우면 `PATH`에서 찾습니다. |
| `axis-share.ai.providers.antigravity.path` | 빈 값 | Antigravity CLI(`agy`) 절대 경로. 비우면 `PATH`에서 찾습니다. |
| `axis-share.ai.autoSync` | `false` | AI 터미널을 열 때 서버 스냅샷을 자동으로 다시 받습니다. AI가 수정한 파일은 덮어쓰지 않습니다. |
| `axis-share.ai.liveSync` | `true` | 다른 사용자의 변경을 제어 WebSocket 알림으로 AI 작업공간에 즉시 반영합니다. AI가 수정 중인 파일은 건너뛰고 충돌로 표시합니다. |
| `axis-share.ai.allowWrite` | `true` | MCP `axis_write_file`을 허용합니다. |
| `axis-share.ai.allowCommit` | `false` | AI commit 도구 허용 여부. 1차 구현에서는 사용하지 않습니다. |
| `axis-share.ai.allowPush` | `false` | AI push 도구 허용 여부. 1차 구현에서는 사용하지 않습니다. |

자체 호스팅 서버를 사용한다면 **앱에서 VSCode로 열기 전에** `axis-share.serverUrl`을 해당 서버의 API 주소로 설정하세요.

## 명령

명령 팔레트에서 `Axis Share`를 검색하거나 사이드바의 컨텍스트 메뉴·타이틀 버튼을 사용합니다.

| 영역 | 명령 |
|:---|:---|
| 브랜치 | 브랜치 전환 |
| 파일 | 새 파일, 새 폴더, 이름 바꾸기, 삭제, 경로 복사, 파일 열기, 새로 고침 |
| Changes | 스테이징, 스테이징 해제, 모두 스테이징, 모두 해제, 커밋, push, pull, fetch, reset, 파일 되돌리기 |
| Diff | 변경 내용 보기, 스테이징 이후 변경 보기, 커밋 변경 내용 보기 |
| Graph | 저장소 전체 그래프 보기 |
| Reviews | 리뷰 데코레이션 추가, 위치로 이동, 삭제, 표시, 숨기기 |
| AI | AI 터미널 열기, 제공자 실행, 작업공간 동기화·초기화, MCP 설정 보기, AI 세션 종료 |
| 계정 | 커밋 사용자 설정 |

## 보안 및 데이터

- 확장은 Axis Flow 비밀번호를 직접 입력받지 않습니다.
- 앱은 60초 동안 유효한 1회용 핸드오프 코드만 전달합니다.
- 확장은 이 코드를 자체 access/refresh token으로 교환합니다.
- 토큰은 VS Code `SecretStorage`에 저장되며 일반 설정 파일에 평문으로 기록되지 않습니다.
- GitHub PAT는 Axis Flow 서버의 저장소 연결 절차에서 사용되며, VS Code 확장에 직접 전달되지 않습니다.
- 실시간 편집 내용은 같은 브랜치에 접속한 사용자에게만 공유됩니다.
- 협업 연결이 끊기면 편집을 잠가 서로 다른 내용이 충돌하는 상황을 줄입니다.
- AI MCP 브리지는 `127.0.0.1`에만 바인딩되고 세션별 시크릿을 사용합니다.
- AI 작업공간에는 Axis 토큰, GitHub PAT, AI API 키를 기록하지 않습니다.
- AI 작업공간 스냅샷에서 `.env`, `.ssh`, 자격 증명 파일은 제외합니다.

## 문제 해결

### 앱에서 VSCode로 열기가 동작하지 않음

- Axis Share 확장이 설치되어 있는지 확인합니다.
- VS Code가 `vscode://` URI 연결을 처리하도록 설치되어 있는지 확인합니다.
- 앱에서 다시 **VSCode로 실시간 편집**을 실행합니다. 핸드오프 코드는 60초 후 만료되며 재사용할 수 없습니다.

### Repository가 비어 있음

- Axis Flow 앱을 거치지 않고 VS Code를 직접 실행한 경우 세션이 없습니다. 앱에서 다시 열어 주세요.
- 저장소 조회 권한이 있는지 확인합니다.
- Activity Bar에서 **Repository** 뷰를 선택하고 새로 고침합니다.

### 편집 중 연결이 끊김

- 하단 상태 표시줄의 Axis Share 상태를 확인합니다.
- 네트워크가 복구되면 자동 재연결을 시도합니다.
- 재연결 후 열려 있던 파일은 서버 내용을 기준으로 다시 동기화됩니다.
- 연결이 끊긴 동안에는 다른 브랜치로 전환하거나 브랜치를 삭제하지 마세요.

### 커밋 입력창이 보이지 않음

- `axis-share.user.name`과 `axis-share.user.email`을 모두 설정했는지 확인합니다.
- 이메일이 Axis Flow 계정 이메일과 일치하는지 확인합니다.

### 브랜치를 삭제할 수 없음

- 기본 브랜치는 삭제할 수 없습니다.
- 다른 사용자가 같은 브랜치에 접속 중이면 삭제할 수 없습니다.
- 커밋되지 않은 변경이 있으면 Changes 뷰에서 확인한 뒤 강제 삭제 여부를 결정합니다.

### 사내/자체 서버에 연결되지 않음

- `axis-share.serverUrl`이 `https://<서버 주소>/api` 형식인지 확인합니다.
- 서버 인증서와 방화벽에서 REST 및 WebSocket 연결이 허용되는지 확인합니다.

### AI CLI에서 Axis MCP 도구가 보이지 않음

- AI 터미널을 Axis Share의 **AI 터미널 열기**로 열었는지 확인합니다.
- `.axis/mcp.json`이 생성되어 있고 `AXIS_BRIDGE_FILE` 경로가 존재하는지 확인합니다.
- Antigravity는 `agy` 실행 후 `/mcp`를 입력해 `axis-share` 서버가 보이는지 확인합니다.
- Antigravity 설정은 `~/.gemini/config/mcp_config.json`에 생성됩니다. `/mcp`에 보이지 않으면 AI 터미널을 다시 열어 설정을 갱신하고 `agy`를 재시작합니다.
- 다른 CLI가 프로젝트 로컬 MCP 설정을 지원하지 않으면 `.axis/mcp.json`의 `axis-share` 항목을 해당 CLI의 전역 설정에 등록합니다.
- CLI를 재시작한 뒤 MCP 도구 목록에 `axis_get_context` 등이 표시되는지 확인합니다.

## 제한 사항

- 한 VS Code 창은 하나의 저장소 세션을 기준으로 동작합니다.
- 초기 연결은 반드시 Axis Flow 앱의 핸드오프 URI로 시작해야 합니다.
- 실시간 협업은 텍스트 파일 편집을 중심으로 동작합니다.
- VS Code의 네이티브 Source Control(SCM) 대신 Axis Share의 **Changes** 뷰를 사용합니다.
- 원격 저장소를 사용자 PC에 직접 clone하는 방식이 아니며, 실제 작업 디렉터리는 Axis Flow 서버가 관리합니다.
- 서버 연결이 없거나 편집 권한이 없으면 파일 생성·수정·커밋을 수행할 수 없습니다.
- AI CLI의 모델 사용량·로그인·요금은 각 CLI 제공자의 정책을 따릅니다.
- AI가 디스크에서 직접 수정한 파일은 자동 동기화되지만, 다른 사용자와 같은 파일을 동시에 고친 경우에는 덮어쓰지 않고 AI 뷰에 충돌 경고를 남깁니다.
- AI commit·push는 기본적으로 제공하지 않으며, 커밋과 push는 Changes 뷰에서 사용자가 직접 수행합니다.

## 개발 및 패키징

```bash
npm ci
npm run check-types
npm run lint
npm run compile
npm run package
```

- `npm run compile`: 타입 검사, 린트, 개발용 esbuild 번들 생성
- `npm run package`: 타입 검사, 린트, 프로덕션 번들 생성
- VS Code에서 F5를 실행하면 Extension Development Host로 확장을 확인할 수 있습니다.

```bash
npx @vscode/vsce package
```

## 지원

설치·권한·저장소 연결 문제는 Axis Flow 워크스페이스 관리자 또는 프로젝트 운영팀에 문의해 주세요. 오류를 전달할 때는 VS Code 버전, Axis Share 버전, 발생 시각, 하단 연결 상태와 오류 메시지를 함께 알려 주면 확인에 도움이 됩니다.
