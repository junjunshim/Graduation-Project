# 조직 관리

### 페이지 목적
* 목적
1. 접근 가능한 조직을 트리 구조로 조회한다.
2. 선택한 조직의 상세 정보와 연결 업무를 확인한다.
3. 하위 조직 생성과 사용자 권한 부여를 수행한다.

## 화면 구성 요소
- 페이지 소개 영역
- 피드백 메시지 영역
- 조직 트리 패널
- 조직 상세 패널
- 관리 가능한 사용자 목록
- 하위 조직 생성 폼
- 권한 부여 폼
- 다음 작업 링크 목록
- 빈 상태 화면(공유 공간 미생성 시)

## 입력값
- 하위 조직 생성
    subNodeType: 조직 유형, 필수
    subNodeName: 조직 이름, 필수
    managerEmail: 관리자 이메일, 필수
    selectedNodeId: 현재 선택 조직, 필수
- 권한부여
    roleEmail: 사용자 이메일, 필수
    assignRoleName: 권한명(ADMIN / MANAGER / MEMBER), 필수
    selectedNodeId: 현재 선택 조직, 필수

## 버튼 동작
- 조직 트리 항목 클릭
    선택 조직 변경
    상세 패널 및 우측 패널 데이터 갱신
- 하위 조직 추가 버튼
    createSubNode(...) 호출
    성공 시 조직 스냅샷 새로고침
    성공 메시지 표시
- 권한 추가 버튼
    assignRoleToNode(...) 호출
    성공 시 조직 스냅샷 새로고침
    성공 메시지 표시
- 공유 공간 만들기 링크
    /setup/top-node 이동
- 다음 작업 링크
    관련 기능 페이지로 이동

## 출력/표시 정보
- 접근 가능한 조직 목록
- 선택 조직의 상세 정보
- 선택 조직 경로, 유형, 하위 조직 정보
- 상속된 관리자 목록
- 직접 연결된 업무 목록
- 다음 작업 추천 링크
- 작업 성공/실패 피드백 메시지

## 검증 규칙
- 로그인 사용자만 접근 가능
- 공유 조직이 하나도 없으면 조직 관리 대신 빈 상태 화면 표시
- 하위 조직 생성 시 선택 조직이 있어야 함
- 하위 조직 이름 필수
- 관리자 이메일은 존재하는 사용자여야 함
- 권한 부여 시 선택 조직이 있어야 함
- 권한 부여 대상 이메일은 존재하는 사용자여야 함
- 동일 사용자/동일 조직/동일 권한의 중복 부여 불가

## 에러/예외 상황
- 공유 공간 없음 → 먼저 공유 공간을 만들어 주세요.
- 기준 조직 미선택 상태에서 생성/권한 부여 시 에러
- 하위 조직 이름 누락
- 관리자 이메일 사용자 없음
- 대상 조직 없음
- 권한 부여 사용자 없음
- 동일 역할 중복 부여
- 실패 시 공통 메시지
- 하위 조직 생성 실패: 하위 조직을 추가하지 못했습니다. 입력 정보를 확인해 주세요.
- 권한 추가 실패: 권한을 추가하지 못했습니다. 입력 정보를 확인해 주세요.

## 관련 파일 경로
- grad_client/renderer/features/org/pages/OrgManagePage.tsx
- grad_client/renderer/features/org/hooks/useOrgManagement.ts
- grad_client/renderer/features/org/components/OrgTree.tsx
- grad_client/renderer/features/org/components/OrgDetailPanel.tsx
- grad_client/renderer/features/org/components/CreateSubNodeForm.tsx
- grad_client/renderer/features/org/components/AssignRoleForm.tsx
- grad_client/renderer/features/workspace/data/orgService.ts
- grad_client/renderer/features/workspace/queries/selectedNodeDetail.ts