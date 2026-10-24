# 회원가입(signup)

## 페이지 목적

서비스를 처음 이용하는 사용자가 이메일 인증을 마친 뒤 계정을 만들고, 개인 공간과 기본 관리자 역할을 부여받는 페이지다.
이메일 인증을 완료하기 전에는 아이디·닉네임·비밀번호 입력과 가입 버튼이 모두 비활성화된다.

## 진입 조건

```typescript
const currentUser = getCurrentUser()
```

- **인증 상태**: 비로그인 상태(`currentUser` 가 null인 경우)에만 접근할 수 있다.
- **경로**: 로그인 화면의 '회원가입' 링크로 진입한다.
- 로그인된 사용자가 접근하면 대시보드로 리다이렉트한다.

## 컴포넌트 상태

- `form`: `userId`, `email`, `name`, `password`
- `verificationStage`: `email` → `code` → `verified`
- `verificationCode`: 이메일로 받은 6자리 인증번호
- `verificationToken`: 인증 확인 성공 시 서버가 발급한 일회용 토큰
- `resendCooldown`: 인증번호 재전송 대기 시간(초)
- `requestingCode`, `confirmingCode`, `submitting`: 단계별 API 호출 상태
- `feedback`, `errorField`: 오류 메시지와 오류 필드 표시

## 화면 단계

| 단계 | 이메일 | 인증번호 | 아이디·닉네임·비밀번호 | 가입 버튼 |
| :--- | :--- | :--- | :--- | :--- |
| `email` | 입력·수정 가능 | 숨김 | 비활성화 | 비활성화 |
| `code` | 읽기 전용 | 입력·확인 가능 | 비활성화 | 비활성화 |
| `verified` | 읽기 전용 | 숨김 | 입력 가능 | 활성화 |

## 주요 버튼 및 기능

| 버튼/기능 | 동작 및 설명 |
| :--- | :--- |
| 인증번호 받기 | 이메일 형식을 검사한 뒤 `POST /api/users/email-verification/request` 호출 |
| 확인 | 6자리 인증번호를 `POST /api/users/email-verification/confirm` 으로 검증하고 인증 완료 토큰 저장 |
| 인증번호 재전송 | 60초 쿨다운이 끝난 뒤 인증번호를 다시 요청 |
| 이메일 변경 | 인증번호·인증 완료 토큰·쿨다운을 초기화하고 이메일 단계로 복귀 |
| 회원가입 | 인증 완료 토큰과 프로필을 `POST /api/users/signup` 으로 전송 |

## 전체 흐름

### 1. 이메일 인증번호 요청

```typescript
const response = await requestSignupEmailVerification(normalizedEmail)
```

- 서버는 이메일을 소문자·앞뒤 공백 제거 형태로 정규화한다.
- 계정 존재 여부나 쿨다운 여부를 응답으로 구분하지 않고 동일한 `200` 메시지를 반환한다.
- 실제 메일이 발송된 경우에만 DB에 bcrypt 해시 형태의 인증번호가 저장된다.
- 기본 정책은 인증번호 10분 만료, 재전송 60초 쿨다운, 이메일당 시간당 5회다.

### 2. 인증번호 확인

```typescript
const response = await confirmSignupEmailVerification(form.email, code)
```

- 인증번호가 맞으면 `verification_token` 과 `expires_in_minutes` 를 받는다.
- 인증번호 오류·만료·시도 횟수 초과는 모두 같은 일반 오류 메시지로 처리한다.
- 기본 정책은 인증번호당 최대 5회 확인, 인증 완료 토큰 15분 만료다.
- 새 인증번호를 요청하면 이전 인증번호와 인증 완료 토큰은 즉시 폐기된다.

### 3. 회원 정보 입력 및 가입

```typescript
const response = await signUp({
  userId,
  email: form.email,
  name,
  password: form.password,
  verificationToken,
})
```

- 아이디: 4~30자, 영문·숫자로 시작, 영문·숫자·`-`·`_` 허용
- 닉네임: 1~50자
- 비밀번호: 8~64자, 영문·숫자·특수문자 포함
- 서버는 인증 완료 토큰의 SHA-256 해시를 DB에서 확인하고, 한 번 사용한 토큰은 재사용할 수 없게 한다.
- 공개 가입 API는 평문 비밀번호만 받고 DB에서 정책 검사와 bcrypt 해싱을 수행한다.

### 4. 가입 성공

- `201 Created` 를 받으면 기존 로그인 API로 자동 로그인한다.
- 자동 로그인까지 성공하면 대시보드로 이동한다.
- 계정은 만들어졌지만 자동 로그인만 실패하면 가입을 다시 시도하지 말고 로그인 화면으로 안내한다.

### 5. 오류 처리

- 이메일 인증 오류가 발생하면 인증 단계와 토큰을 초기화하고 이메일 단계로 돌아간다.
- 아이디·이메일 중복, 닉네임·비밀번호 정책 위반은 해당 입력 필드에 오류를 표시한다.
- 네트워크 오류는 현재 단계에서 재시도할 수 있도록 안내한다.

## 관련 API

| Method | Path | 설명 |
| :--- | :--- | :--- |
| POST | `/api/users/email-verification/request` | 인증번호 요청 |
| POST | `/api/users/email-verification/confirm` | 인증번호 확인 및 인증 완료 토큰 발급 |
| POST | `/api/users/signup` | 인증 완료 토큰으로 계정 생성 |
| POST | `/api/users/login` | 가입 성공 후 자동 로그인 |

## 클릭 후 이동 페이지

| 메뉴 | 이동 | MD링크 |
| :--- | :--- | :--- |
| 회원가입 (성공) | 대시보드 페이지 | [link](dashboard.md) |
| 회원가입 (자동 로그인 실패) | 로그인 페이지 | [link](login.md) |
| 로그인 | 로그인 페이지 | [link](login.md) |
