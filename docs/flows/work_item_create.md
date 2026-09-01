# 업무 생성

### 컴포넌트 구조
- **WorkItemCreatePage** :
    - 전체 레이아웃 구성, `handleSubmit`을 통한 최종 데이터 검증 및 API 호출, 페이지 라우팅
    - Page (`WorkItemCreatePage.tsx`) --> Hook (`useWorkItemCreateForm.ts`)
    - Page --> Service (`workItemService.ts`)  

- **중앙 레이아웃 분리** :
    - Page --> Form (`WorkItemCreateForm.tsx`)
    - Page --> Sidebar (`WorkItemCreateSidebar.tsx`)

- **useWorkItemCreateForm** :
    - `form` 상태 관리, `composer` 데이터 로드  

- **WorkItemCreateForm**
    - 입력 필드 렌더링, `onFieldChange`를 통해 부모에게 데이터 전달

- **WorkItemCreateSidebar** :
    - 현재 업무 ID, 조직 경로, 작성 가이드 등 읽기 전용 정보 제공

- **workItemService** : 
    - `createWorkItem` 를 통한 실제 통신 담당

## 페이지 목적 
* 개별 업무의 제목, 내용, 우선순위, 마감일을 설정합니다. 생성된 업무를 특정 조직에 연결하고, 업무 데이터를 데이터베이스에 등록하여 대시보드에서 활용할 수 있게 합니다.

## 진입 조건
* **인증 상태**: 유효한 로그인 세션이 필요합니다. 
* **경로**: 
    - 조직 관리 페이지의 "다음 작업" 세션의 "업무 등록" 클릭
    - 좌측 사이드바의 "업무 등록" 클릭

## 주요 버튼 및 기능

| 기능 | 설명 |
| :--- | :--- |
| 업무 기본 정보 | 업무 제목과 설명을 입력하는 기능 (`form.title`, `form.description`) |
| 조직과 담당자 | 업무의 담당 조직, 담당자, 상위 업무 지정 기능 (`form.ownerNodeId`, `form.ownerUserId`, `form.parentWorkItemId` ) |
| 상태와 일정 | 업무의 상태, 시작일, 마감일 설정 (`form.status`, `form.startDate`, `form.dueDate`) |
| 우선순위와 진행 값 | 업무의 우선순위, 가중치, 진행률 설정 (`form.priority`, `form.weight`, `form.progress`) |
| 현재 작성 문서 | ID, 기준 조직, 경로 등의 정보 표기 (`WorkItemCreateSidebar`) |
| 선택 가능한 범위 | 조직 개수, 담당자 수, 상위 업무 개수 표기 (`WorkItemCreateSidebar`) |

## 클릭 후 이동 페이지
| 메뉴/버튼 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 대시보드 (좌측 사이드바) | 대시보드 페이지로 이동 | [link](dashboard.md) |
| 조직 관리 (좌측 사이드바) | 조직 관리 페이지로 이동 | [link](org_manage.md) |
| 업무 등록 (메인) | 클릭 시 업무 데이터 저장 (`createWorkItem`) | - |

## 전체 흐름 

### 1. 데이터 로드
`useWorkItemCreateForm.ts`
```typescript
export function useWorkItemCreateForm(userId?: string) { 
    const composer = getWorkItemComposerContext(userId, form.ownerNodeId ? Number(form.ownerNodeId) : undefined)
    // ... 
 }
```
- 페이지에 진입하면 훅이 실행되어 선택 가능한 조직과 유저 목록을 가져옵니다.
<br><br/>
### 2. 레이아웃 배치 및 상태 연결
`WorkItemCreateForm.tsx`
```typescript
<label className={styles.field}>
          <span className={styles.label}>업무 제목</span>
          <input
            className={styles.input}
            value={form.title}
            onChange={(event) => onFieldChange('title', event.target.value)}
            placeholder="업무 제목을 입력해 주세요"
          />
        </label>

<label className={styles.field}>
          <span className={styles.label}>설명</span>
          <textarea
            className={styles.textarea}
            value={form.description}
            onChange={(event) => onFieldChange('description', event.target.value)}
            placeholder="업무 목적, 산출물, 참고 사항을 입력해 주세요"
          />
        </label>

// ...

<label className={styles.field}>
            <span className={styles.label}>진행률 (0-100)</span>
            <input
              type="number"
              min={0}
              max={100}
              className={styles.input}
              value={form.progress}
              onChange={(event) => onFieldChange('progress', event.target.value)}
            />
          </label>
```
`WorkItemCreateSidebar.tsx`

```typescript
export function WorkItemCreateSidebar({ composer }: WorkItemCreateSidebarProps) { ... }
```
- 훅에서 받은 데이터를 입력 폼과 우측 정보 섹션에 전달합니다.
<br><br/>
### 3. 사용자 입력
`WorkItemCreateForm.tsx`
```typescript
export function WorkItemCreateForm({ composer, form, onFieldChange }) {
    return (
    // ...
       <select
              className={styles.input}
              value={form.ownerNodeId}
              onChange={(event) => onFieldChange('ownerNodeId', event.target.value)}
            >
              {composer.availableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
       </select>
    // ...
}
```
```typescript
<input
            className={styles.input}
            value={form.title}
            onChange={(event) => onFieldChange('title', event.target.value)}
            placeholder="업무 제목을 입력해 주세요"
        />
```
- 사용자가 값을 입력하면 `onFieldChange`를 통해 상위 훅의 상태를 변경합니다.
<br><br/>
### 4. 유효성 검사 및 전송
`WorkItemCreatePage.tsx`
```typescript
async function handleSubmit(event: FormEvent) {
  event.preventDefault();
  
  const response = await createWorkItem({
    ownerNodeId: Number(form.ownerNodeId),
    priority: Number(form.priority),
    // ... 
  });
}
```
- 최종 제출 시 데이터를 변환하고 API를 호출합니다.
