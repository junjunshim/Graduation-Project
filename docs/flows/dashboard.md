# 대시보드(Dashboard)

### 컴포넌트 구조
- **DashboardPage (중앙 컨트롤러)** : 전체 로직을 관장하며, 데이터를 불러와 배분합니다.

    - `getCurrentUser()`로 인증을 확인한 뒤, `getWorkspaceOverview(userId)`를 호출하여 페이지에 필요한 데이터를 `overview` 객체로 로드  

    - **신규 사용자**: `orgNodeCount === 0`일 때 `onboardingSteps`를 활용한 가이드 화면 렌더링  

    - **기존 사용자**: 운영 현황 통계 및 업무 리스트가 포함된 메인 대시보드 렌더링  

- **하위 프리젠테이션 컴포넌트** : `DashboardPage`로부터 데이터를 받아 시각화합니다.
    - **MetricCard (`<article>`)** :

        - 전달 데이터: `label`, `value`, `description`

        - 특징: `metricsGrid` 영역에서 정보를 시각화

    - **NodeTree (`<ul>`, `<li>`)** :

        - 전달 데이터: `node (WorkspaceNodeView)`

        - 특징: 조직의 계층 구조를 호출하여 트리 형태로 출력. 내부적으로 `getNodeTypeLabel` 등을 사용하여 메타데이터를 표시

- **유틸리티 및 모델 레이어** : 컴포넌트가 데이터를 읽기 좋은 형태로 가공할 때 의존하는 외부 모듈입니다.
    - **Labels/Formatters** : `getNodeTypeLabel`, `formatWorkspaceDate` 등을 통해 데이터를 사용자 친화적인 텍스트로 변환
    - **Styles (CSS Modules)**: `DashboardPage.module.css`를 참조

## 페이지 목적
* 사용자의 업무 현황, 프로젝트 진척도, 최근 활동 내역 등을 한눈에 파악할 수 있도록 요약된 정보를 제공하고, 각 상세 업무로 빠르게 이동할 수 있습니다.

## 진입 조건

- **인증 상태** : 유효한 사용자 세션 또는 토큰을 보유한 인증된 사용자여야 합니다.

- **경로** : 로그인에 성공한 경우, 혹은 사이드바 내의 '대시보드' 메뉴 클릭 시 진입합니다.

## 주요 버튼 및 기능

| 버튼/기능 | 동작 및 설명 |
| :--- | :--- |
| 공간 만들기 | 사용자 계정에 공유 공간이 없는 경우에 버튼 표시, 공유 공간 생성 페이지로 이동(`TopNodeSetupPage.tsx`)|
| 사이드바 메뉴 | 조직 관리, 업무 등록 등의 페이지로 이동하는 기능 |
| 메인 화면 (상단) | 공유 조직, 전체 업무, 평균 진행률, 루트 업무 등의 정보를 제공하는 개요 화면 (`overview` 반환) |
| 메인 화면 | 조직 현황, 루트 권한 사용자, 최근 등록된 업무 등의 정보 확인과 동시에 조직 관리, 업무 등록 등의 기능 페이지로 이동 버튼 포함 |
| 바로 진행할 작업 | 조직 추가, 권한 배치, 업무 등록 등의 기능을 모아놓은 항목 |

## 클릭 후 이동 페이지

| 메뉴 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 공간 만들기 | 공유 공간 생성 페이지 (`TopNodeSetupPage.tsx`)| - |
| 조직관리(사이드바), 조직 추가(메인), 권한 배치 | 조직 관리 페이지 | [link](org_manage.md) |
| 업무등록(사이드바, 메인) | 업무 등록 페이지 | [link](work_item_create.md) |
| 로그아웃 | 로그아웃 후 로그인 페이지로 이동 | [link](login.md) |

## 전체 흐름 

### 1. 세션 정보 가져오기
```typescript
export function DashboardPage() {
  const currentUser = getCurrentUser()

  if (!currentUser) {
    return null
  }
```
- `auth/api` 모듈에서 사용자 정보를 가져옵니다. 로그인이 되어있지 않은 경우 `null`을 반환합니다.
<br><br/>
### 2. 데이터 로드
```typescript
const overview = getWorkspaceOverview(currentUser.userId) 
const workspaceName = overview.rootNode?.name ?? '워크스페이스'
```
- 데이터베이스 조회를 거쳐 `overview` 객체를 반환합니다. 조직 수, 전체 업무, 평균 진행률 등의 정보를 포함하고 있습니다.
<br><br/>
### 3. 사용자 상태에 따른 화면 분기
- 사용자가 서비스를 처음 이용하는지, 이미 운영 중인지에 따라 두 가지 화면 중 하나를 선택합니다.
### Case A : 신규 사용자
```typescript
if (overview.summary.orgNodeCount === 0)
```
- 생성된 조직이 없는 신규 사용자의 경우, 공유 공간 생성 화면을 보여줍니다.

### Case B : 기존 사용자
- 이미 조직이 등록된 경우, 메인 대시보드를 보여줍니다.
<br><br/>
### 4. 지표 시각화
```typescript
const summaryCards = [
    { label: '공유 조직', value: overview.summary.orgNodeCount, description: '운영 중인 조직 수' },
    { label: '전체 업무', value: overview.summary.workItemCount, description: '현재 조회 가능한 업무' },
    { label: '평균 진행률', value: `${overview.summary.averageProgress}%`, description: '전체 업무 기준 평균' },
    { label: '루트 업무', value: overview.summary.rootWorkItemCount, description: '상위 업무 기준 집계' },
  ]


 {summaryCards.map((card) => (
          <article key={card.label} className={styles.metricCard}>
            <p className={styles.metricLabel}>{card.label}</p>
            <strong className={styles.metricValue}>{card.value}</strong>
            <p className={styles.metricDescription}>{card.description}</p>
          </article>
```
- `overview.summary`에서 추출한 데이터를 `summaryCards` 배열로 재가공한 뒤, article 태그를 통해 그리드 형태로 뿌려줍니다.
<br><br/>
### 5. 조직 및 업무 리스트

- **조직 현황** : `NodeTree` 컴포넌트를 사용하여 조직 계층 구조를 출력합니다.
- **우선 확인할 업무** : `overview.urgentWorkItems` 를 `WorkItemRow` 컴포넌트로 변환하여 리스트를 만듭니다.
```typescript
{overview.urgentWorkItems.map((item) => <WorkItemRow key={item.workItemId} item={item} />)}
```
<br><br/>
### 6. 부가 정보 및 액션 유도 
- 협업 인원과 최근 소식, 바로가기 버튼을 배치합니다.

    - 루트 권한 사용자: `overview.rootRoleMembers` 데이터를 매핑하여 관리자 명단을 보여줍니다.

    - 최근 업무: `overview.recentWorkItems`를 통해 최신 업데이트 현황을 공유합니다.

    - 바로 진행할 작업: `Link` 컴포넌트를 사용하여 '조직 추가', '업무 등록' 등 핵심 액션 페이지로 연결합니다.