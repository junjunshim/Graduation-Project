# 회원가입 API

이메일 인증을 완료한 사용자가 계정을 생성하는 API다.
`Authorization` 헤더는 필요하지 않으며, 인증 완료 토큰은 앞선 인증번호 확인 API에서 발급받는다.

## Request

| Method | URL |
| :--- | :--- |
| POST | `http://{서버 url}/api/users/signup` |

```json
{
  "user_id": "User_100",
  "email": "user@example.com",
  "name": "테스터",
  "password": "Test!@2211",
  "verification_token": "64자리_소문자_16진수"
}
```

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 4~30자, 영문·숫자로 시작, 영문·숫자·`-`·`_` 허용 |
| email | String | 필수 | 인증을 완료한 이메일(소문자·앞뒤 공백 정규화) |
| name | String | 필수 | 닉네임, 1~50자 |
| password | String | 필수 | 8~64자, 영문·숫자·특수문자 포함 |
| verification_token | String | 필수 | 인증번호 확인 성공 시 받은 일회용 토큰(64자리 16진수) |

## Response

### 성공

```json
{
  "status": "success",
  "message": "회원가입이 완료되었습니다."
}
```

상태 코드는 `201 Created` 다.

### 실패

```json
{
  "status": "error",
  "message": "이메일 인증이 유효하지 않거나 만료되었습니다. 인증을 다시 진행해 주세요."
}
```

| 상태 코드 | 의미 |
| :--- | :--- |
| 201 | 계정 생성 완료 |
| 400 | 필수 값 누락, 입력 정책 위반, 중복 아이디·이메일, 인증 토큰 무효·만료 |
| 429 | Nginx IP 단위 요청 제한 초과 |
| 500 | DB 처리 실패 |

## 처리 규칙

1. 인증 완료 토큰은 DB에 SHA-256 해시로만 저장되며, 계정 생성 시 한 번만 사용할 수 있다.
2. 인증을 완료한 이메일과 가입 요청 이메일이 같아야 한다.
3. 중복된 `user_id`는 `[P0510]`, 중복된 `email`은 `[P0501]`로 처리한다.
4. 공개 가입 경로는 평문 비밀번호만 허용하고, 서버가 아닌 DB 함수에서 정책 검사와 bcrypt 해싱을 수행한다.
5. 성공 시 개인 공간 노드와 기본 관리자 역할을 함께 생성한다.

## 관련 API

| Method | URL | 설명 |
| :--- | :--- | :--- |
| POST | `/api/users/email-verification/request` | 인증번호 요청 |
| POST | `/api/users/email-verification/confirm` | 인증번호 확인 및 토큰 발급 |
| POST | `/api/users/signup` | 계정 생성 |
