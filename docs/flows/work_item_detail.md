# 업무 상세

### 컴포넌트 구조
- **WorkItemDetailPage** :
    - URL 파라미터 (`workItemId`) 추출
    - 데이터 로딩 (`getSelectedWorkItemDetail`), 예외 화면 제어
    - Page (`WorkItemDetailPage.tsx`) --> Query (`selectedWorkItemDetail.ts`)

- **Icon** : 
    - 디자인 시스템, 시각적 요소 렌더링  

- **RelatedWorkItemLink** :
    - 상위/하위 업무의 요약 정보를 렌더링, 클릭 시 해당 업무 상세로 이동하는 `Link` 포함

- **StatusBadge** : 
    - 업무 상태(`todo`, `inProgress`, `done`)에 따라 동적인 스타일을 적용하여 표시

- **외부 유틸리티**
    - Format (`formatters.ts`)
    - Labels (`labels.ts`)

## 페이지 목적
* 특정 업무의 일정 및 진행 요약, 업무 설명, 속성, 상위 업무와 하위 업무 등 업무의 세부 사항을 한눈에 파악할 수 있도록 정보를 시각화하여 제공합니다.

## 진입 조건

* **인증 상태**: 유효한 로그인 세션이 필요합니다.
* **조건**:  
    - 생성된 업무가 존재해야 합니다.
    - `const { workItemId } = useParams()` - React Router를 통해 업무 ID를 성공적으로 추출해야 합니다.
    - 입력된 `workItemId` 가 데이터베이스에 실제로 존재해야 합니다.

## 주요 버튼 및 기능

| 버튼/기능 | 설명 |
| :--- | :--- |
| 화면 상단 | 업무 타이틀, 담당자, 소유 조직, 마감일 등 기본 정보 표기 (`header`)|
| 일정 및 진행 요약 | 진행률, 우선순위, 가중치, 시작일, 마감일 정보 표기 (`progressTrack`- 진행률 시각화 ) |
| 상위 업무, 하위 업무 |  상위, 하위 업무가 존재할 경우 리스트 표기 (`parentWorkItem`, `childWorkItems`)|
| 속성 | 현재 선택한 업무의 대부분의 정보 나열 (`detailSidebar`) |
| 수정 | - 개발 예정 - |


## 클릭 후 이동 페이지

| 메뉴/버튼 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 상위 업무 | 선택한 상위 업무의 업무 상세 페이지로 이동 | - |
| 하위 업무 | 선택한 하위 업무의 업무 상세 페이지로 이동 | - |
| 대시보드로 돌아가기 | 대시보드 페이지로 이동 | [link](dashboard.md) |
| 수정 | - 개발 예정 - | |

## 전체 흐름 

### 1. 진입 및 데이터 로드
`WorkItemDetailPage.tsx`

```typescript
export function WorkItemDetailPage() {
  const currentUser = getCurrentUser(); 
  const { workItemId } = useParams();   

  if (!currentUser) return null;

  const detail = workItemId ? getSelectedWorkItemDetail(workItemId, currentUser.userId) : null;
```
- 페이지가 로드되면 URL 파라미터에서 업무 ID를 추출하고, 상세 데이터를 가져옵니다.
<br><br/>

### 2. 예외 처리 흐름
```typescript
 if (!detail) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <p className={styles.eyebrow}>Work Item</p>
          <h2 className={styles.emptyTitle}>업무를 찾을 수 없습니다.</h2>
          <p className={styles.emptyText}>
            요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다. 대시보드에서 다시 선택해 주세요.
          </p>
          <div className={styles.emptyActions}>
            <Link to="/dashboard" className={styles.primaryAction}>
              대시보드로 돌아가기
            </Link>
            <Link to="/work-items/new" className={styles.secondaryAction}>
              업무 등록
            </Link>
          </div>
        </div>
      </section>
    )
  }
```
- 데이터가 없거나 접근할 수 없을 경우, 사용자가 다른 행동을 할 수 있도록 예외 처리를 진행합니다.
<br><br/>

### 3. 헤더 : 핵심 요약 및 액션
```typescript
<header className={styles.header}>
        <div className={styles.headerPrimary}>
          <p className={styles.eyebrow}>Work Item Detail</p>

          <div className={styles.identityRow}>
            <span className={styles.workItemId}>{item.workItemId}</span>
            <span
              className={[
                styles.statusBadge,
                tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
              ].join(' ')}
            >
              {getWorkItemStatusLabel(item.status)}
            </span>
          </div>

          <h2 className={styles.title}>{item.title}</h2>
          <p className={styles.description}>{description}</p>
          <p className={styles.metaLine}>
            담당자 {ownerUser.name} ({ownerUser.userId}) · {getNodeTypeLabel(ownerNode.nodeType)} {ownerNode.name} ·
            마감 {formatWorkspaceDate(item.dueDate)}
          </p>
        </div>

        <div className={styles.headerActions}>
          <Link to={`/work-items/${item.workItemId}/edit`} className={styles.primaryAction}>
            수정
          </Link>
          <Link to="/dashboard" className={styles.secondaryAction}>
            대시보드로 돌아가기
          </Link>
        </div>
      </header>
```
- 업무의 제목과 상태를 요약해서 보여주고, 대시보드, 수정 버튼이 위치합니다.
<br><br/>

### 4. 일정 및 진행 요약
```typescript
 <div className={styles.progressBlock}>
              <div className={styles.progressHeader}>
                <strong>진행률 {item.progress}%</strong>
                <span>{getWorkItemStatusLabel(item.status)}</span>
              </div>
              <div className={styles.progressTrack} aria-hidden="true">
                <span className={styles.progressValue} style={{ width: `${item.progress}%` }} />
              </div>
            </div>

             <div className={styles.metricGrid}>
              <div className={styles.metricItem}>
                <span>우선순위</span>
                <strong>{item.priority}</strong>
              </div>
              
               ...

              <div className={styles.metricItem}>
                <span>마감일</span>
                <strong>{formatWorkspaceDate(item.dueDate)}</strong>
              </div>
            </div>


<RelatedWorkItemLink item={parentWorkItem} prefix="상위 업무" />

<RelatedWorkItemLink key={childItem.workItemId} item={childItem} prefix="하위 업무" />
```
- 진행 상태를 시각화하고 상하위 업무 간의 연결 상태를 보여줍니다. 상하위 업무의 특정 업무를 클릭 시 해당 업무의 상세 페이지로 이동할 수 있습니다.
<br><br/>

### 5. 상세 속성
```typescript
<aside className={styles.detailSidebar}>
          <section className={styles.sidePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Properties</p>
                <h3 className={styles.panelTitle}>속성</h3>
              </div>
            </div>

 <dl className={styles.propertyList}>
              <div className={styles.propertyItem}>
                <dt>상태</dt>

                ...

<div className={styles.propertyItem}>
                <dt>마감일</dt>
                <dd>{formatWorkspaceDate(item.dueDate)}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>생성일</dt>
                <dd>{formatWorkspaceTimestamp(item.createdAt)}</dd>
              </div>
            </dl>
```
- 업무의 상세 속성을 `<dl>` 형태로 나열합니다.