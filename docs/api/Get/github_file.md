# GitHub 저장소 파일 내용 조회 api
- 지정한 브랜치 및 파일 경로의 내용(blob)을 조회하는 api (버전 지정 및 캐시 조건부 조회 지원)
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/file?repo_id=1&branch=main&path=src/index.ts&ref=head |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| repo_id | Integer | 필수 | 저장소 식별 id |
| path | String | 필수 | 파일 상대 경로 |
| branch | String | 선택 | 브랜치명 (생략 시 기본 브랜치) |
| ref | String | 선택 | 읽을 버전 종류 (`head`, `index`, 또는 특정 커밋 `<sha>`) |
| since | String | 선택 | 클라이언트 캐시 시각 (변경된 경우에만 내용 반환) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "path": "src/index.ts",
            "content": "console.log('Hello World');\n",
            "size": 28,
            "encoding": "utf-8",
            "ref": "main",
            "modified_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "파일 내용을 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "404",
    "message": "파일을 찾을 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 파일 내용 데이터 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. `ref` 파라미터로 `head`(기본값, 브랜치 최신 커밋 내용), `index`(스테이징된 인덱스 내용), 또는 임의의 커밋 SHA 버전을 지정할 수 있습니다.<br>
2. 파일이 해당 버전에 존재하지 않는 경우 404 상태 코드가 반환됩니다.<br>
