# Axis Share

Axis Flow 워크스페이스의 원격 저장소를 VSCode 에서 **실시간으로 함께 편집**하는 확장(guest 클라이언트)입니다.

## 무엇을 하는 확장인가

- 앱(Axis Flow)에서 저장소를 연결하고 **"VSCode 로 실시간 편집"** 을 누르면, 앱이 `vscode://junjunshim.axis-share/auth?...` URI 로 이 확장을 깨웁니다.
- 확장은 전달받은 1회용 코드를 서버 토큰으로 교환한 뒤, 서버에 보관된 저장소의 **브랜치별 작업 디렉터리**를 사이드바에 띄웁니다.
- 편집은 파일 전체를 미리 받지 않습니다. **디렉터리 구조만** 먼저 받고, 파일 내용은 열 때 가져옵니다.
- 같은 브랜치에 있는 사람들끼리만 실시간으로 공유됩니다(브랜치가 작업 단위).
- 커밋도 저장소가 아니라 **브랜치 단위**입니다.

## 사이드바

| 뷰 | 내용 |
|:---|:---|
| Repository | 저장소 디렉터리/파일 트리, 브랜치 전환·생성·삭제, git 상태 배지(`M`/`A`/`U`/`D`) |
| Editing | 지금 이 브랜치에서 편집 중인 사용자(파일 기준) |
| Reviews | 브랜치의 리뷰 데코레이션(오타·문법·논리·기타·강조) |

커밋 UI 는 VS Code 의 **소스 제어(SCM)** 를 그대로 씁니다(`user.name` / `user.email` 이 설정되어 있어야 커밋 입력창이 열립니다).

## 개발

```bash
npm install
npm run compile     # 타입 검사 + lint + 번들(dist/extension.js)
npm test            # 확장 호스트 테스트
```

- F5 로 확장 호스트를 띄워 확인합니다(`.vscode/launch.json`).
- 서버 주소는 설정 `axis-share.serverUrl` 로 바꿉니다(기본 `https://axisflow.team/api`).
- 설계 기준 문서: `.antigravitycli/agent/tasks/TASK_11_SERVER_LOCAL_REPO_VSCODE.md`
  - §15 = 사이드바 UI 설계, §15.13 = 확장 식별자·매니페스트 기준값

## 현재 상태

**뼈대만 있는 상태입니다.** 뷰·커맨드는 매니페스트에 선언되어 있지만, 동작은 자리표시자(안내 메시지)입니다.
실제 구현은 위 설계 문서의 §15 를 기준으로 진행합니다.