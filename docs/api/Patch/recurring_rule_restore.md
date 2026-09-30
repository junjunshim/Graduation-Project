# 정기 일정 복구 api
- 휴지통(삭제 상태)에 있는 정기 일정(반복 규칙)을 복구하는 api
- 소속 노드가 아직 삭제 상태이면 복구할 수 없습니다.
- 작성자/담당자이거나 노드에 `WI_PERSONAL_CHANGE`(본인 일정) 또는 `WI_OTHERS_CHANGE`(타인 일정) 권한이 있어야 합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/recurringRules/3/restore?cascade=true |

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
| ruleId | Integer | 필수 | 복구할 정기 일정 식별 id (URL 경로) |
| cascade | Boolean | 선택 | 일정 전용 첨부파일까지 함께 복구할지 여부 (기본값: false) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "RECURRING_RULE",
            "rule_id" : 3,
            "owner_node_id" : 98,
            "creator_user_id" : "U-163",
            "creator_email" : "apple_1dept_leader@apple.com",
            "creator_name" : "애플 기획부 팀장",
            "assignee_user_id" : "U-164",
            "assignee_email" : "apple_member@apple.com",
            "assignee_name" : "애플 기획부 팀원",
            "title" : "주간 운영 회의",
            "description" : "서비스 운영 현황과 주요 이슈를 공유합니다.",
            "category" : "MEETING",
            "frequency" : "WEEKLY",
            "interval_value" : 1,
            "by_day" : "TU",
            "by_month_day" : null,
            "by_set_pos" : null,
            "start_time" : "10:00:00",
            "duration_minutes" : 60,
            "repeat_start_date" : "2026-09-01",
            "repeat_end_date" : null,
            "max_occurrences" : null,
            "exclude_holidays" : true,
            "holiday_action" : "SKIP",
            "auto_create_task" : false,
            "is_active" : true,
            "is_deleted" : false,
            "created_at" : "2026-09-01T00:00:00.000000Z",
            "updated_at" : "2026-09-21T00:00:00.000000Z",
            "checklists" : [],
            "files" : []
        }
    ]
}
```
```json
{
    "status" : "error",
    "message" : {에러 메세지}
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 |
| data | Array | 성공 | 복구된 정기 일정 상세 데이터 배열 (RECURRING_RULE) |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (RECURRING_RULE) |
| rule_id | Integer | 필수 | 정기 일정 식별 id |
| owner_node_id | Integer | 필수 | 일정 소속 노드 id |
| creator_user_id | String | 필수 | 일정 생성자 사용자 id |
| creator_email | String | 필수 | 일정 생성자 이메일 |
| creator_name | String | 필수 | 일정 생성자 이름 |
| assignee_user_id | String or Null | 선택 | 일정 담당자 사용자 id (미정이면 null) |
| assignee_email | String or Null | 선택 | 일정 담당자 이메일 |
| assignee_name | String or Null | 선택 | 일정 담당자 이름 |
| title | String | 필수 | 일정 제목 |
| description | String or Null | 선택 | 일정 설명 |
| category | String | 필수 | 일정 카테고리 |
| frequency | String | 필수 | 반복 주기 (DAILY, WEEKLY, MONTHLY, YEARLY) |
| interval_value | Integer | 필수 | 반복 간격 |
| by_day | String or Null | 선택 | 반복 요일 |
| by_month_day | Integer or Null | 선택 | 월간 반복 일자 |
| by_set_pos | Integer or Null | 선택 | 월간 반복 주차 |
| start_time | String or Null | 선택 | 시작 시간 |
| duration_minutes | Integer | 선택 | 소요 시간(분) |
| repeat_start_date | String | 필수 | 반복 시작 기준일 |
| repeat_end_date | String or Null | 선택 | 반복 종료일 |
| max_occurrences | Integer or Null | 선택 | 최대 반복 횟수 |
| exclude_holidays | Boolean | 필수 | 공휴일 제외 여부 |
| holiday_action | String | 필수 | 공휴일 처리 방식 |
| auto_create_task | Boolean | 필수 | 자동 업무 생성 여부 |
| is_active | Boolean | 필수 | 일정 활성 여부 |
| is_deleted | Boolean | 필수 | 삭제 여부 (false) |
| created_at | String | 필수 | 생성 일시 |
| updated_at | String | 필수 | 최신 수정 일시 |
| checklists | Array | 필수 | 일정 체크리스트 템플릿 목록 |
| files | Array | 필수 | 일정 전용 첨부파일 메타데이터 목록 (cascade=false 이면 삭제된 파일 유지) |

## 정책
- 소속 노드가 삭제 상태이면 복구할 수 없다. (HTTP 409)
- `cascade=true` 이면 일정 전용 첨부파일도 함께 복구된다.