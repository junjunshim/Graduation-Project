# 📄 API 명세서

## 공통 응답/요청 방식 정의
- **api 요청 형식** : application/json 으로 제한
- **성공/실패** 여부는 HTTP 상태코드를 통해서 제공

| HTTP Status | Code | Message | Description |
| :--- | :--- | :--- | :--- |
| OK | 200 | 성공 | 요청이 성공적으로 처리됨 |
| Created | 201 | 생성됨 | 새로운 조직 노드가 성공적으로 생성됨 |
| No Content | 204 | 내용 없음 | 삭제 요청 성공 (반환할 본문 없음) |
| Bad Request | 400 | 부적절한 요청 | 필수 파라미터 누락 또는 데이터 형식 오류 |
| Unauthorized | 401 | 권한 없음 | 인증이 필요하거나 유효하지 않은 토큰 |
| Forbidden | 403 | 접근 거부 | 해당 노드에 대한 수정/삭제 권한 없음 |
| Not Found | 404 | 찾을 수 없음 | 존재하지 않는 노드 ID 참조 |
| Conflict | 409 | 충돌 | 중복된 데이터 또는 비즈니스 로직 충돌 |
| Internal Server Error | 500 | 서버 오류 | DB 연결 실패 또는 서버 내부 로직 오류 |

- **공통 에러 응답 객체**
```json
{
  "status": "error",
  "code": "404",
  "message": "부모 노드가 존재하지 않습니다.",
  "detail": "parent_node_id: 999"
}
```

---

## API
### 회원가입 api(version 1)
- **endpoint** : /api/v1/users
- **method** : Post
- **description** : 회원가입 절차를 진행한다.
- **request body**
```json
{
  "user_id" : "U-1001",
  "email" : "test123@gmail.com",
  "name" : "테스터",
  "password" : "test112233!@#",
}
```
- **success response**
```json
{
  "status" : "success",
  "message" : "User registered successfully"
}
```
- **error response**
```json
{
  "status" : "error",
  "message" : 내부 에러 메세지
}
```
