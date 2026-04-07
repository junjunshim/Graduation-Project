# 대시보드

### 페이지 목적
* 목적
1. 로그인 사용자가 접근 가능한 조직/업무 현황을 한눈에 확인한다.
2. 공유 조직이 없을 경우 온보딩 화면으로 최초 설정을 유도한다.
3. 조직 관리, 업무 생성, 업무 상세로 빠르게 이동한다.

## 화면 구성 요소
- 페이지 소개 영역
- 요약 카드 영역
- 공유 조직 수
- 전체 업무 수
- 평균 진행률
- 루트 업무 수
- 조직 현황 트리
- 우선 확인 업무 목록
- 루트 권한 사용자 목록
- 최근 등록 업무 목록
- 바로 진행할 작업 액션 카드
- 온보딩 체크리스트 영역(조직이 없는 경우)

## 입력값
- 직접 입력값 없음
- 현재 로그인 사용자 기준으로 데이터 조회

## 버튼 동작
- 조직 관리 링크 ( /org/manage 이동 )
- 새 업무 링크 ( /work-items/new 이동 )
- 업무 행 클릭 ( /work-items/:workItemId 이동 )
- 온보딩 단계 링크
    ( 단계별 지정 경로 이동 )
    ( /setup/top-node )
    ( /org/manage )
    ( /work-items/new )
## 출력/표시 정보
- 사용자 권한 기준 접근 가능한 조직/업무 요약 정보
- 조직 트리 구조
- 우선순위/마감일 기준 업무 목록
- 최근 등록된 업무 목록
- 루트 조직 권한 사용자 목록
- 공유 조직이 없으면 온보딩 화면 표시
## 검증 규칙
- 로그인 사용자만 접근 가능
- 현재 사용자 기준 접근 가능한 조직/업무만 표시
- 공유 조직이 0개이면 일반 대시보드 대신 온보딩 화면 출력
## 에러/예외 상황
- 로그인 사용자 없음 → 보호 라우트에서 /login으로 이동
- 우선 업무 없음 → 등록된 우선 업무가 없습니다.
- 최근 업무 없음 → 최근 등록된 업무가 없습니다.
- 루트 권한 사용자 없음 → 루트 권한 사용자가 없습니다.
- 조직 미구성 상태 → 체크리스트형 온보딩 화면 표시
## 관련 파일 경로
- grad_client/renderer/features/dashboard/pages/DashboardPage.tsx
- grad_client/renderer/features/workspace/queries/workspaceOverview.ts
- grad_client/renderer/features/workspace/data/orgService.ts
- grad_client/renderer/features/workspace/model/labels.ts
- grad_client/renderer/features/workspace/model/formatters.ts