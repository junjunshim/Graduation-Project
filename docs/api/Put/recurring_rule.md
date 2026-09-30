# 정기 일정 수정 api
- 정기 일정(반복 규칙)의 속성과 체크리스트를 수정하는 api
- 작성자/담당자이거나 노드에 `WI_PERSONAL_CHANGE`(본인 일정) 또는 `WI_OTHERS_CHANGE`(타인 일정) 권한이 있어야 합니다.
- 전달한 필드만 갱신하는 부분 수정 방식이며, 키를 생략하면 해당 값은 변경되지 않습니다.
## Request
- Request syntax
```json
{
    "title" : "주간 운영 회의 (변경)",
    "description" : "운영 현황과 주요 이슈를 공유합니다.",
    "category" : "MEETING",
    "frequency" : "WEEKLY",
    "interval_value" : 2,
    "by_day" : "TU,TH",
    "start_time" : "09:30:00",
    "duration_minutes" : 90,
    "repeat_start_date" : "2026-09-01",
    "repeat_end_date" : "2026-12-31",
    "max_occurrences" : null,
    "exclude_holidays" : true,
    "holiday_action" : "NEXT_WORKDAY",
    "auto_create_task" : true,
    "is_active" : true,
    "assignee_user_email" : "apple_member@apple.com",
    "checklists" : [
        { "content" : "회의록 작성", "sort_order" : 0 },
        { "content" : "액션 아이템 등록", "sort_order" : 1 }
    ]
}
```

| Method | URL |
| :--- | :--- |
| Put | http://{서버 url}/api/recurringRules/3 |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| title | String | 선택 | 일정 제목 |
| assignee_user_email | String | 선택 | 일정 담당자 email (빈 문자열이면 담당자 미정으로 변경) |
| description | String | 선택 | 일정 설명 |
| category | String | 선택 | 일정 카테고리 |
| frequency | String | 선택 | 반복 주기 |
| interval_value | Integer | 선택 | 반복 간격 |
| by_day | String | 선택 | 반복 요일 |
| by_month_day | Integer | 선택 | 월간 반복 일자 (1~31) |
| by_set_pos | Integer | 선택 | 월간 반복 주차 |
| start_time | String | 선택 | 시작 시간 |
| duration_minutes | Integer | 선택 | 소요 시간(분) |
| repeat_start_date | String | 선택 | 반복 시작 기준일 |
| repeat_end_date | String | 선택 | 반복 종료일 |
| max_occurrences | Integer | 선택 | 최대 반복 횟수 |
| exclude_holidays | Boolean | 선택 | 공휴일 제외 여부 |
| holiday_action | String | 선택 | 공휴일 처리 방식 |
| auto_create_task | Boolean | 선택 | 자동 업무 생성 여부 |
| is_active | Boolean | 선택 | 일정 활성 여부 |
| checklists | Array | 선택 | 체크리스트 템플릿 목록 (전달 시 기존 목록을 교체) |

- 키를 생략하면 해당 값은 변경되지 않는다. `checklists` 를 생략하면 체크리스트도 유지된다.

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : {
        "type" : "RECURRING_RULE",
        "rule_id" : 3,
        "owner_node_id" : 98,
        "creator_user_id" : "U-163",
        "creator_email" : "apple_1dept_leader@apple.com",
        "creator_name" : "애플 기획부 팀장",
        "assignee_user_id" : "U-164",
        "assignee_email" : "apple_member@apple.com",
        "assignee_name" : "애플 기획부 팀원",
        "title" : "주간 운영 회의 (변경)",
        "description" : "운영 현황과 주요 이슈를 공유합니다.",
        "category" : "MEETING",
        "frequency" : "WEEKLY",
        "interval_value" : 2,
        "by_day" : "TU,TH",
        "by_month_day" : null,
        "by_set_pos" : null,
        "start_time" : "09:30:00",
        "duration_minutes" : 90,
        "repeat_start_date" : "2026-09-01",
        "repeat_end_date" : "2026-12-31",
        "max_occurrences" : null,
        "exclude_holidays" : true,
        "holiday_action" : "NEXT_WORKDAY",
        "auto_create_task" : true,
        "is_active" : true,
        "is_deleted" : false,
        "created_at" : "2026-09-01T00:00:00.000000Z",
        "updated_at" : "2026-09-20T00:00:00.000000Z",
        "checklists" : [
            {
                "checklist_id" : 11,
                "content" : "회의록 작성",
                "sort_order" : 0,
                "created_at" : "2026-09-01T00:00:00.000000Z"
            },
            {
                "checklist_id" : 12,
                "content" : "액션 아이템 등록",
                "sort_order" : 1,
                "created_at" : "2026-09-20T00:00:00.000000Z"
            }
        ],
        "files" : []
    }
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
| data | Object | 성공 | 갱신된 정기 일정 상세 데이터 (RECURRING_RULE) |
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
| is_deleted | Boolean | 필수 | 삭제 여부 |
| created_at | String | 필수 | 생성 일시 |
| updated_at | String | 필수 | 최신 수정 일시 |
| checklists | Array | 필수 | 일정 체크리스트 템플릿 목록 |
| files | Array | 필수 | 일정 전용 첨부파일 메타데이터 목록 |

## 정책
- 작성자/담당자가 아닌 경우 노드의 `WI_OTHERS_CHANGE` 권한이 필요하다. 그 외에는 `WI_PERSONAL_CHANGE` 가 필요하다.
- `checklists` 를 전달하면 기존 체크리스트를 모두 교체한다. 생략하면 유지한다.
- 삭제된 일정은 수정할 수 없다.