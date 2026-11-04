# 정기 일정 상세 조회 api
- 단일 정기 일정(반복 규칙)의 상세 정보를 체크리스트, 첨부파일 메타데이터와 함께 조회하는 api
- 응답의 `data` 는 단일 객체(`RECURRING_RULE`)이며, 목록 조회에서의 `checklists`/`files` 구조와 동일합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/recurringRules/3 |

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
| ruleId | Integer | 필수 | 조회할 정기 일정 식별 id (URL 경로) |

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
        "updated_at" : "2026-09-01T00:00:00.000000Z",
        "checklists" : [
            {
                "checklist_id" : 11,
                "content" : "회의록 작성",
                "sort_order" : 0,
                "created_at" : "2026-09-01T00:00:00.000000Z"
            }
        ],
        "files" : [
            {
                "file_id" : 7,
                "rule_id" : 3,
                "uploader_user_id" : "U-163",
                "uploader_email" : "apple_1dept_leader@apple.com",
                "uploader_name" : "애플 기획부 팀장",
                "original_file_name" : "meeting_template.docx",
                "file_size" : 20480,
                "mime_type" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "is_deleted" : false,
                "created_at" : "2026-09-01T00:00:00.000000Z"
            }
        ]
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
| data | Object | 성공 | 정기 일정 상세 데이터 (RECURRING_RULE) |
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
| category | String | 필수 | 일정 카테고리 (ROUTINE, REPORT, INSPECTION, MEETING, EVENT) |
| frequency | String | 필수 | 반복 주기 (DAILY, WEEKLY, MONTHLY, YEARLY) |
| interval_value | Integer | 필수 | 반복 간격 (N일/N주/N개월) |
| by_day | String or Null | 선택 | 반복 요일 ('MO', 'TU,TH' 등) |
| by_month_day | Integer or Null | 선택 | 월간 반복 일자 (1~31) |
| by_set_pos | Integer or Null | 선택 | 월간 반복 주차 (1: 첫째 주, -1: 마지막 주) |
| start_time | String or Null | 선택 | 일정 시작 시간 |
| duration_minutes | Integer | 선택 | 소요 시간(분) |
| repeat_start_date | String | 필수 | 반복 시작 기준일 |
| repeat_end_date | String or Null | 선택 | 반복 종료일 (null: 무기한) |
| max_occurrences | Integer or Null | 선택 | 최대 반복 횟수 |
| exclude_holidays | Boolean | 필수 | 공휴일 제외 여부 |
| holiday_action | String | 필수 | 공휴일 처리 방식 (SKIP, NEXT_WORKDAY, PREV_WORKDAY) |
| auto_create_task | Boolean | 필수 | 자동 업무 생성 여부 |
| is_active | Boolean | 필수 | 일정 활성 여부 |
| is_deleted | Boolean | 필수 | 삭제 여부 |
| created_at | String | 필수 | 생성 일시 |
| updated_at | String | 필수 | 최신 수정 일시 |
| checklists | Array | 필수 | 일정 체크리스트 템플릿 목록 |
| files | Array | 필수 | 일정 전용 첨부파일 메타데이터 목록 |

- checklists Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| checklist_id | Integer | 필수 | 체크리스트 식별 id |
| content | String | 필수 | 체크리스트 내용 |
| sort_order | Integer | 필수 | 정렬 순서 |
| created_at | String | 필수 | 생성 일시 |

- files Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| file_id | Integer | 필수 | 파일 식별 id |
| rule_id | Integer | 필수 | 소속 정기 일정 id |
| uploader_user_id | String | 필수 | 업로더 사용자 id |
| uploader_email | String | 필수 | 업로더 이메일 |
| uploader_name | String | 필수 | 업로더 이름 |
| original_file_name | String | 필수 | 원본 파일명 |
| file_size | Integer | 필수 | 파일 크기 (Bytes) |
| mime_type | String or Null | 선택 | 파일 MIME 타입 |
| is_deleted | Boolean | 필수 | 삭제 여부 |
| created_at | String | 필수 | 업로드 일시 |

## 정책
- 요청자는 해당 노드에 `NODE_INFO_VIEW` 권한이 있어야 한다.
- 상세 조회의 `files` 에는 삭제된 파일도 포함된다.