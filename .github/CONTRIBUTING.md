# 🤝 졸업작품 협업 가이드 (Contributing Guidelines)

우리 팀의 일관성 있는 개발과 효율적인 협업을 위해 아래 규칙을 준수합니다. 모든 팀원은 코드를 작성하거나 수정하기 전에 이 가이드를 숙지해야 합니다.


## 1. 🌿 브랜치 전략 (Branching Strategy)
우리는 **Git Flow**를 단순화한 방식을 사용합니다.

- **main**: 최종 배포 및 교수님 제출용 브랜치 (가장 안정적인 상태 유지)
- **develop**: 각 기능이 합쳐지는 메인 개발 브랜치
- **feature/[기능명]**: 단위 기능을 개발하는 브랜치 (예: `feature/camera-driver`, `feature/ui-layout`)

> **작업 흐름**: `feature`에서 작업 완료 -> `develop`으로 Pull Request(PR) -> 리뷰 후 Merge -> 최종 단계에서 `main`으로 Merge


## 💬 2. 커밋 메시지 규칙 (Commit Message)
메시지는 `태그: 작업 내용` 형식을 유지하며, 첫 글자는 대문자로 시작합니다.

- `Feat`: 새로운 기능 추가
- `Fix`: 버그 수정
- `Docs`: 문서 수정 (README, 보고서 등)
- `Style`: 코드 포맷팅, 세미콜론 누락 등 (로직 변경 없음)
- `Refactor`: 코드 리팩토링
- `Move`: 파일 이동 혹은 이름 변경
- `Chore`: 빌드 설정, 패키지 관리, 폴더 구조 변경 등

**예시**: `Feat: OpenCV 이미지 필터링 로직 구현`


## 💻 3. C++ 코드 스타일 (Code Style)
우리 프로젝트는 **Google C++ Style Guide**를 지향합니다.

- **명명 규칙**
  - 파일/폴더명 : `Kebab Case` | ex : `user-profile.cpp` 
  - 클래스/구조체 : `PascalCase` | ex : `UserAccount`, `MainService` 
  - 함수/변수 : `camelCase` | ex : `isLoggedIn`, `getUserData()`
  - 멤버 변수 : `m_` 접두사 사용 | ex : `m_health`
  - 상수 : `UPPER_SNAKE_CASE` | ex : `API_URL`, `MAX_LIMIT`
- **포맷팅** : 저장소 루트에 있는 `.clang-format` 설정을 따릅니다. 커밋 전 에디터의 자동 정렬 기능을 활용하세요.


## 🚀 4. Pull Request & Code Review
- 모든 PR은 최소 **1명 이상의 팀원에게 승인(Approve)**을 받아야 `develop`에 머지할 수 있습니다.
- PR을 올릴 때는 어떤 부분이 변경되었는지, 테스트는 완료했는지 명확히 기술합니다.
- 리뷰어는 코드의 로직뿐만 아니라 가독성과 메모리 누수 가능성을 함께 체크합니다.

### ✅ Pull Request 전 체크리스트
- [ ] 로컬 환경에서 컴파일 에러 없이 빌드되는가?
- [ ] 새롭게 추가된 기능에 대해 충분한 주석을 달았는가?
- [ ] 불필요한 디버그용 출력문(`cout`, `printf`)은 제거했는가?
- [ ] 사용하지 않는 `include` 문이나 변수는 정리했는가?


## 📦 5. 외부 라이브러리 추가
- 새로운 외부 라이브러리나 패키지를 추가해야 할 경우, 반드시 팀원들과 사전 논의를 거칩니다.
- 추가 후에는 `CMakeLists.txt` 업데이트 내용과 설치 방법을 팀 채널에 공유합니다.


## 🚨 6. 충돌 해결 (Conflict Resolution)
- `develop` 브랜치의 최신 내용을 본인의 `feature` 브랜치로 수시로 `pull` 받아 충돌을 미리 방지합니다.
- 충돌 발생 시, 해당 코드를 작성한 팀원과 상의하여 해결한 후 커밋합니다. 절대로 다른 사람의 코드를 임의로 삭제하지 않습니다.


## ⚠️ 7. 주의 사항
- **헤더 관리** : 모든 헤더 파일(`.h`, `.hpp`) 상단에는 반드시 `#pragma once`를 포함합니다.
- **포인터** : `NULL`이나 `0` 대신 `nullptr`을 사용합니다.
- **커밋** : 커밋 전 빌드가 정상적으로 되는지 반드시 로컬에서 확인합니다.

