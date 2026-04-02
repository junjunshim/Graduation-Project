# 회원가입(signup)

### 컴포넌트 구조
- **SignupPage** : 페이지의 전체 생명주기와 비즈니스 로직을 담당합니다.

    - `form` : 사용자가 입력한 회원 정보 객체 (`email`, `password`, `name`)
    - `submitting` : API 호출 중 로딩 상태
    - `feedback` : 회원가입 실패 시 에러 메시지 관리
    - `handleSubmit()`: 폼 제출 시 실행. 결과에 따라 대시보드로 이동

- **AuthPageLayout** : 시각적인 디자인과 폼의 배치를 담당합니다.

  - 관계 : `SignupPage` 가 이 컴포넌트를 사용
  - 로그인 페이지와 동일한 디자인 시스템 내에서 회원가입 전용 UI를 렌더링

- **API Service**: 실제 API 통신을 담당합니다.

  - `signUp()`: 수집된 `form` 데이터를 로컬 스토리지에 저장
  - `getCurrentUser()` : 가입 절차 진입 전 이미 로그인된 사용자인지 확인하여 리다이렉트 여부를 결정

## 페이지 목적
* 서비스를 처음 이용하는 사용자가 이메일과 비밀번호 등을 등록하여 새로운 계정을 생성하고, 서비스 이용 권한을 부여받기 위한 페이지입니다.

## 진입 조건
```typescript
const currentUser = getCurrentUser()
```
* **인증 상태**: 비로그인 상태(`currentUser` 가 null인 경우) 에만 접근 가능합니다.
* **경로**: 서비스 메인 접속 후 '회원가입' 클릭 시 진입합니다.

## 주요 버튼 및 기능

| 버튼/기능 | 동작 및 설명 |
| :--- | :--- |
| 이메일 입력 | `form.email` 상태 업데이트 |
| 이름 입력 | `form.name` 상태 업데이트 |
| 비밀번호 입력 | `form.password` 상태 업데이트 |
| 회원가입 | `signUp` API 호출 및 계정 생성 요청 |

## 클릭 후 이동 페이지

| 메뉴 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 회원가입 (성공) | 대시보드 페이지 | [link](dashboard.md) |
| 회원가입 (실패) | 현재 페이지 유지 | - |
| 로그인 | 로그인 페이지 | [link](login.md) |

## 전체 흐름 

### 1. 진입 및 인증 상태 확인
```typescript
const currentUser = getCurrentUser()

if (currentUser) {
  return <Navigate to="/dashboard" replace /> 
}
```
- `getCurrentUser()`를 통해 로컬 스토리지에 저장된 유저 정보를 가져옵니다.
로그인된 상태라면 대시보드로 이동합니다.
<br><br/>
### 2. 사용자 입력 및 동기화
```typescript
const [form, setForm] = useState(initialForm) 

onChange={(event) => setForm((current) => ({ 
  ...current, 
  email: event.target.value 
}))}
```
- `form.email` 과 `form.password` 에 데이터가 실시간으로 저장됩니다.
<br><br/>

### 3. 폼 제출
```typescript
async function handleSubmit(event: React.FormEvent<HTMLFormElement>) 

  const response = await signIn({ 
    email: form.email,
    password: form.password,
  })
  
  setSubmitting(false)   
```
- api에 요청하고 비동기 통신을 수행합니다.
- `await signIn(...)` : 응답이 올 때까지 함수 실행을 일시 정지시킵니다.
- 요청 완료 후 로딩이 해제됩니다.
<br><br/>
### 4. 응답 처리
```typescript
 if (!form.email.trim() || !form.name.trim() || !form.password.trim()) {
      setSubmitting(false)
      setFeedback({
        tone: 'error',
        message: '필수 정보를 모두 입력해 주세요.',
      })
      return
    }

if (response.status === 'error') {
      setFeedback({
        tone: 'error',
        message: '가입 정보를 다시 확인해 주세요.',
      })
      return
    }
```
```typescript
navigate('/dashboard', { replace: true })
```
- 회원가입에 실패할 경우 에러 메시지가 표시되며 다시 입력받습니다.
- 성공 시 대시보드 페이지로 이동합니다.
- `replace: true` : 뒤로 가기로 이동해도 로그인 폼으로 돌아가지 않습니다.
<br><br/>
### 5. 데모 기능
```typescript
import { enterDemoWorkspace, getCurrentUser, signIn } from '../api'

<button type="button" className={styles.secondaryButton} onClick={handleDemoEnter}>데모로 시작하기</button>
```
- '데모로 시작하기' 클릭 시 `enterDemoWorkspace` API 호출 후 대시보드로 이동합니다.