# 조직 관리

### 컴포넌트 구조
- **최상위 페이지**
    - `OrgManagePage` --> `useOrgManagement`
    
- **접근 가능한 조직 구조**
    - `OrgManagePage` --> `OrgTree`
    - `OrgTree` --> `TreeBranch`
    
- **상세 정보**
    - `OrgManagePage` --> `OrgDetailPanel` 
    - `OrgDetailPanel` --> `WorkItemBadge`
    
- **사용자 액션**
    - `OrgManagePage` --> `CreateSubNodeForm`
    - `OrgManagePage` --> `AssignRoleForm`
    
- **공통 참조 파일**
    - `OrgDetailPanel` --> `labels.ts`
    - `OrgDetailPanel` --> `formatters.ts`
    - `CreateSubNodeForm` --> `labels.ts`
    - `OrgTree` --> `labels.ts`

## 페이지 목적
* 조직의 계층 구조를 설계하고, 각 조직 단위별로 담당자를 배치하거나 접근 권한을 설정합니다.

## 진입 조건

* **인증 상태** : 유효한 로그인 세션이 필요합니다.  

* **경로**: 
    - 사이드바의 '조직 관리' 메뉴 클릭.

    - 대시보드 내 '조직 현황' 섹션의 [조직 관리] 클릭.

    - 대시보드 하단 '바로 진행할 작업' 카드에서 [조직 추가] 또는 [권한 배치] 클릭.

## 주요 버튼 및 기능

| 버튼/기능 | 동작 및 설명 |
| :--- | :--- |
| 하위 조직 추가  | 현재 선택된 조직 하위에 새로운 하위 조직 생성 |
| 권한 추가 | 특정 사용자에게 해당 조직의 admin, manager, member 권한 부여 |
| 업무 등록 | 선택한 조직에 새 업무 등록 |
| 접근 가능한 조직 | 전체 조직의 트리 구조를 펼치거나 접으며 확인 | 

## 클릭 후 이동 페이지

| 메뉴 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 하위 조직 추가 | 현재 선택된 조직 (`CreateSubNodeFormProps`) 의 하위 조직 생성 (`CreateSubNodeForm()`) | - |
| 권한 추가 | 지정한 사용자에게 특정 권한 부여 (`AssignRoleForm.tsx`) | - |
| 업무등록(사이드바, 메인) | 업무 등록 페이지 | [link](work_item_create.md) |
| 대시보드 | 대시보드 페이지로 이동 | [link](dashboard.md) |

## 전체 흐름 

### 1. 접근 가능한 조직
`OrgTree.tsx`
```typescript
type OrgTreeProps = {
  nodes: OrganizationNodeRecord[]
  rootNodes: OrganizationNodeRecord[]
  selectedNodeId: number | null
  onSelect: (nodeId: number) => void
}

function TreeBranch( ... )

export function OrgTree( ... )
```
- 조직의 계층 구조를 시각화하고, 특정 조직을 선택할 수 있습니다.

```typescript
 {children.length > 0 ? (
        <ul className={styles.treeChildren}>
          {children.map((child) => (
            <TreeBranch
              key={child.id}
              nodeId={child.id}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              nodes={nodes}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
```
- `children.length > 0` 일 경우, `<ul>` 태그 안에 다시 `TreeBranch`를 매핑합니다. 이 과정을 통해 하위 트리가 무한히 확장됩니다.  
<br><br/>
### 2. 조직 상세 정보
`OrgDetailPanel.tsx`
```typescript
<strong className={styles.summaryTitle}>{selectedDetail.node.name}</strong>
```
- 현재 선택한 조직이 전체 계층 구조 중 어디에 위치하는지 보여줍니다.  

| 섹션 | 데이터 | 설명 |
| :-- | :-- | :-- |
| 하위 조직 | `childNodes` | 현재 조직 바로 아래 단계의 조직들을 나열 |
| 직접 부여된 권한 | `directRoles` | 이 조직에 할당된 사용자명, 이메일, 역할 표시 |
| 직접 연결된 업무 | `directWorkItems` | `Link` 컴포넌트를 사용해 클릭 시 해당 업무 상세 페이지로 이동 가능 |
<br><br/>

### 3. 하위 조직 추가
`CreateSubNodeForm.tsx`
```typescript
export function CreateSubNodeForm( ... )
```
- 사용자로부터 세 가지 정보를 입력받습니다.

| 입력 필드 | 데이터 타입 | 설명 |
| :-- | :-- | :-- |
| 조직 유형 | `select` | `DIVISION`, `DEPARTMENT`, `TEAM`, `PROJECT` 중 선택 |
| 조직 이름 | `input` | 생성할 하위 조직의 명칭 |
| 관리자 | `select` | 시스템에 등록된 사용자 중 선택하여 관리자로 지정 |
<br><br/>

### 4. 사용자에게 권한 부여
`AssignRoleForm.tsx`
```typescript
<select className={styles.input} value={roleEmail} onChange={(event) => onRoleEmailChange(event.target.value)}>
  {users.map((member) => (
    <option key={member.userId} value={member.email}>
      {member.name} ({member.userId})
    </option>
  ))}
</select>
```
- 시스템에 등록된 전체 사용자 리스트를 보여줍니다.

```typescript
<select
  className={styles.input}
  value={assignRoleName}
  onChange={(event) => onAssignRoleNameChange(event.target.value as RoleName)}
>
  {roleOptions.map((role) => (
    <option key={role} value={role}>{role}</option>
  ))}
</select>
```
- 부여할 권한 등급을 선택합니다.
<br><br/>

### 5. 다음 작업
`OrgManagePage.tsx`
```typescript
import { Link } from 'react-router-dom'

{selectedDetail ? (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <p className={styles.panelEyebrow}>Next Actions</p>
                  <h3 className={styles.panelTitle}>다음 작업</h3>
                </div>
              </div>

              <div className={styles.nextActionList}>
                {selectedDetail.nextActions.map((action) => (
                  <Link key={action.label} to={action.href} className={styles.nextActionItem}>
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
```
- `react-router-dom` 의 `Link`를 사용하여 클릭 시 해당 경로로 즉시 이동합니다.
