# 업무 상세

### 페이지 목적
* 목적
1. 선택한 업무의 상세 정보, 진행 현황, 설명, 상위/하위 업무 관계를 조회한다.
2. 업무 수정 화면으로 진입한다.

## 화면 구성 요소
- 헤더 영역
    업무 ID
    상태 배지
    제목
    설명
    담당자 / 조직 / 마감일 메타 정보
- 수정 버튼
- 대시보드로 돌아가기 버튼
- 진행 요약 패널
- 업무 설명 패널
- 상위 업무 패널
- 하위 업무 패널
- 속성 사이드바
    상태
    진행률
    우선순위
    가중치
    담당자
    소유 조직
    조직 경로
    시작일
    마감일
    생성일
- 빈 상태 화면

## 입력값
- 직접 입력값 없음
- URL 파라미터 : workItemId

## 버튼 동작
- 수정 버튼 : /work-items/workItemId/edit 이동
- 대시보드로 돌아가기 버튼 : /dashboard 이동
- 상위/하위 업무 링크 클릭 : 해당 업무 상세 페이지로 이동
- 빈 상태 화면의 업무 등록 버튼 : /work-items/new 이동

## 출력/표시 정보
- 업무 기본 정보
- 상태 배지
- 진행률 바
- 우선순위 / 가중치 / 일정
- 설명 본문
- 상위 업무 정보
- 하위 업무 목록
- 담당자/조직/경로 상세 정보
- 업무 설명이 비어 있으면 : 업무 설명이 아직 등록되지 않았습니다.

## 검증 규칙
- 로그인 사용자만 접근 가능
- 현재 사용자 권한으로 접근 가능한 조직의 업무만 조회 가능
- workItemId가 없거나 조회 실패 시 상세 화면 대신 빈 상태 표시

## 에러/예외 상황
- 업무 없음
- 권한상 접근 불가 업무
- 소유 조직/담당자 정보 누락
- 잘못된 URL 파라미터
- 조회 실패 시:
    업무를 찾을 수 없습니다.
    요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다.

## 관련 파일 경로
- grad_client/renderer/features/work-item/pages/WorkItemDetailPage.tsx
- grad_client/renderer/features/workspace/queries/selectedWorkItemDetail.ts
- grad_client/renderer/features/workspace/data/orgService.ts
- grad_client/renderer/features/workspace/model/labels.ts
- grad_client/renderer/features/workspace/model/formatters.ts