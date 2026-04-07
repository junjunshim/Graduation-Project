# 로그인(Login)

### 컴포넌트 구조
- **LoginPage**  : 페이지의 메인 로직을 담당합니다.

  - `form` : 사용자가 입력한 이메일, 비밀번호 객체
  - `submitting` : API 호출 중 로딩 상태
  - `feedback` : 로그인 실패 시 에러 메시지 관리
- **AuthPageLayout**: 시각적인 디자인과 폼의 배치를 담당합니다.

  - 관계 : `LoginPage` 가 이 컴포넌트를 사용

- **API Service**: 실제 API 통신을 담당합니다.

  - `signIn` : 서버 통신 수행
  - `getCurrentUser()` : 현재 세션 유무 확인
  - `enterDemoWorkspace()` : 데모 환경 진입 처리

- **React Router** : 페이지 이동을 지원합니다.

  - `useNavigate()` : 로그인 성공 시 대시보드로 이동하는 기능
  - `Link` : 회원가입 페이지로 전환

## 페이지 목적
- 사용자 검증을 통해 접근 권한을 부여하여 로그인하거나 유효하지 않은 사용자의 접근을 차단하는 페이지입니다.

## 진입 조건
```typescript
const currentUser = getCurrentUser()
```
- **인증 상태** : 비로그인 상태(`currentUser` 가 null인 경우) 에만 접근 가능합니다. 
-  이미 로그인된 상태에서 접근 시, `getCurrentUser()` 체크를 통해 즉시 대시보드로 이동합니다.

## 주요 버튼/기능
| 버튼/기능 | 동작 및 설명 |
| :--- | :--- |
| 회원가입 | 회원가입 페이지로 이동 |
| 이메일 입력 | `form.email` 상태 업데이트 |
| 비밀번호 입력 | `form.password` 상태 업데이트 |
| 로그인 | `signIn` API 호출 및 응답 대기 |

## 클릭 후 이동 페이지
| 메뉴 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 회원가입 | 회원가입 페이지 | [link](signup.md) |
| 로그인 성공 | 대시보드 페이지 | [link](dashboard.md) |
| 로그인 실패 | 현재 페이지 유지 (`feedback` 상태) | - |

## 전체 흐름

### 1. 초기화 및 체크
```typescript
const currentUser = getCurrentUser()


 if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }
```
- 페이지 렌더링 시 사용자의 로그인 여부 확인 , 이미 로그인된 경우 대시보드로 이동합니다.
<br><br/>

### 2. 데이터 입력
```typescript
const [form, setForm] = useState(initialForm)

onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} className={styles.input}

onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} className={styles.input}
```
- `email`과 `password` 입력, `form` 객체에 실시간 저장됩니다.
<br><br/>

### 3. 인증 요청
```typescript
import { enterDemoWorkspace, getCurrentUser, signIn } from '../api'

 const response = await signIn({
      email: form.email,
      password: form.password,
    })
```
- 수집된 `form` 데이터를 `signIn` 을 통해 비동기 호출하여 API로 전송합니다.
<br><br/>

### 4. 응답 처리
- **성공** : 성공 응답 수신 시 `useNavigate` 를 사용하여 대시보드로 이동
- **실패** : `setFeedback` 을 통해 사용자에게 메시지 노출 및 로딩 상태 해제
<br><br/>
### 5. 데모 기능
```typescript
import { enterDemoWorkspace, getCurrentUser, signIn } from '../api'

<button type="button" className={styles.secondaryButton} onClick={handleDemoEnter}>데모로 시작하기</button>
```
- '데모로 시작하기' 클릭 시 `enterDemoWorkspace` API 호출 후 대시보드로 이동합니다.