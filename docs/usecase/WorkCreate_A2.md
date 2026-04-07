# 업무 생성

### 페이지 목적
* 목적 
1. 새로운 업무를 생성한다.
2. 담당 조직, 담당자, 상위 업무, 상태, 일정, 진행률 등 업무 속성을 한 화면에서 입력한다.

## 화면 구성 요소
- 페이지 소개 영역
- 업무 기본 정보 섹션
    제목
    설명
- 조직/담당자 섹션
    담당 조직 select
    담당자 select
    상위 업무 select
- 상태/일정 섹션
    상태 select
    시작일
    마감일
- 진행 정보 섹션
    우선순위
    가중치
    진행률
- 피드백 메시지 영역
- 생성 버튼
- 우측 사이드바
    현재 작성 문서 정보
    선택 가능한 범위
    작성 팁
## 입력값
- title: string, 필수
- description: string, 선택
- ownerNodeId: string(number), 필수
- ownerUserId: string, 필수
- parentWorkItemId: string, 선택
- status: todo | in-progress | done, 필수
- priority: string(number), 기본값 3
- weight: string(number), 기본값 1
- progress: string(number), 기본값 0
- startDate: string, 선택
- dueDate: string, 선택

## 버튼 동작
- 업무 생성 버튼
    폼 submit 수행
    제목 공백 검사
    createWorkItem(...) 호출
    성공 시 /dashboard 이동
    실패 시 에러 메시지 표시
- 조직 선택 시
    선택 조직 기준으로 담당자/상위 업무 후보가 재계산됨

## 출력/표시 정보
- 생성 예정 업무 ID
- 현재 기준 조직과 조직 경로
- 선택 가능한 조직 수 / 담당자 수 / 상위 업무 수
- 작성 팁
- 처리 중 버튼 상태 또는 피드백 메시지
- 실패 시: (업무 정보를 다시 확인해 주세요.)

## 검증 규칙
- 로그인 사용자만 접근 가능
- composer context가 있어야 화면 표시 가능
- 제목 필수
- 우선순위 입력 범위: 1~5
- 가중치 입력 범위: 0 이상
- 진행률 입력 범위: 0~100
- 상위 업무는 현재 선택 조직 경로 기준으로 선택 가능
- 담당자는 선택 조직 경로의 역할 사용자 기준으로 선택 가능

## 에러/예외 상황제목 미입력
- 업무 생성 서비스 실패
- composer 데이터 없으면 화면 렌더링 불가
- 잘못된 조직/담당자/업무 ID 전달 시 생성 실패 가능
- 일정 미입력은 허용됨

## 관련 파일 경로
- grad_client/renderer/features/work-item/pages/WorkItemCreatePage.tsx
- grad_client/renderer/features/work-item/components/WorkItemCreateForm.tsx
- grad_client/renderer/features/work-item/components/WorkItemCreateSidebar.tsx
- grad_client/renderer/features/work-item/hooks/useWorkItemCreateForm.ts
- grad_client/renderer/features/workspace/queries/workItemComposer.ts
- grad_client/renderer/features/workspace/data/workItemService.ts