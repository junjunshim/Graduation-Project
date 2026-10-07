# Change Log

## 0.0.1

- 확장 뼈대 생성
  - 매니페스트: Repository 컨테이너 1개 + 뷰 3개(Repository/Editing/Reviews), 커맨드 14개, 메뉴, 설정 4개, 색 13종
  - 빌드 구성: `tsconfig.json`, `esbuild.js`, `eslint.config.mjs`, `.vscode/launch.json`·`tasks.json`
  - 핸드오프 URI(`vscode://junjunshim.axis-share/auth`) 수신 골격
- 사이드바 트리, 브랜치, 실시간 동기화, 커밋(SCM) 로직은 다음 단계에서 구현한다.