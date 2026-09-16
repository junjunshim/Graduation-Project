# 대시보드 데이터 조회 api
- 대시보드 화면 전용 조회 api
- 사용자의 스코프를 계산한 뒤, 담당자가 본인인 업무(최근 6개월)와 스코프에 속한 정기 일정 전체를 함께 반환합니다.
- 화면 상단의 "오늘/이번 주" 기준 집계를 위해 조회자 정보와 기준일을 함께 내려줍니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/context/dashboard |

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
| (없음) | - | - | 별도 파라미터 없음 (토큰의 사용자를 기준으로 스코프/업무 계산) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "server_time" : "2026-09-16 09:12:00.000000+00",
    "data" : [
        {
            "type" : "DASHBOARD_VIEWER",
            "user_id" : "U-163",
            "email" : "apple_1dept_leader@apple.com",
            "name" : "애플 기획부 팀장",
            "role" : "ADMIN",
            "node_id" : 98,
            "node_title" : "애플 기획부",
            "today" : "2026-09-16",
            "week_start_date" : "2026-09-14",
            "week_end_date" : "2026-09-20",
            "range_start_date" : "2026-03-16"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-196",
            "display_id" : 196,
            "parent_id" : "WI-194",
            "owner_node_id" : 98,
            "owner_user_id" : "U-163",
            "title" : "기획부 세부 구현 스프린트",
            "description" : "애플 기획부의 세부 마일스톤 기획 및 리소스 설계",
            "category" : "FEATURE",
            "status" : "in_progress",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 40,
            "comment_count" : 4,
            "is_deleted" : false,
            "start_date" : "2026-09-11",
            "due_date" : "2026-09-13",
            "updated_at" : "2026-09-16T08:54:49.604005Z"
        },
        {
            "type" : "RECURRING_RULE",
            "rule_id" : 3,
            "owner_node_id" : 98,
            "creator_user_id" : "U-163",
            "assignee_user_id" : "U-164",
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
            "updated_at" : "2026-09-01T00:00:00.000000Z"
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
| server_time | String | 성공 | 서버의 현재 시간 |
| data | Array | 성공 | 조회자/기준일(DASHBOARD_VIEWER) 1건, 담당 업무(WORK_ITEM), 스코프 정기 일정(RECURRING_RULE) 통합 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (DASHBOARD_VIEWER, WORK_ITEM, RECURRING_RULE) |
| user_id | String | viewer, work_item | 사용자 id (WORK_ITEM에서는 담당자 id) |
| email | String | viewer | 조회자 이메일 |
| name | String | viewer | 조회자 이름 |
| role | String | viewer | 조회자의 대표 역할 이름 (최상위 역할 우선) |
| node_id | Integer | viewer, recurring_rule | viewer는 대표 역할이 배정된 노드 id, recurring_rule은 일정 소속 노드 id |
| node_title | String or Null | viewer | 대표 역할이 배정된 노드 이름 |
| today | String | viewer | 서버 기준 오늘 날짜 (Asia/Seoul, YYYY-MM-DD) |
| week_start_date | String | viewer | 이번 주 시작일 (월요일) |
| week_end_date | String | viewer | 이번 주 종료일 (일요일) |
| range_start_date | String | viewer | 업무 조회 범위 시작일 (오늘 - 6개월) |
| id | String | work_item | 업무 식별 id (WI-xxx) |
| display_id | Integer | work_item | 노드 내 업무 표시 번호 |
| parent_id | String or Null | work_item | 상위 업무 id |
| owner_node_id | Integer | work_item | 업무 소속 노드 id |
| owner_user_id | String | work_item | 업무 담당자 사용자 id (항상 조회자 본인) |
| title | String | work_item, recurring_rule | 업무 제목 또는 일정 제목 |
| description | String or Null | work_item, recurring_rule | 업무 설명 또는 일정 설명 |
| category | String or Null | work_item, recurring_rule | 업무 카테고리 또는 일정 카테고리 |
| status | String | work_item | 업무 상태 (todo, in_progress, done 등) |
| priority | Integer | work_item | 업무 우선순위 |
| hidden | Boolean | work_item | 업무 숨김 여부 |
| weight | Integer | work_item | 업무 가중치 |
| progress | Integer | work_item | 업무 진행률 |
| comment_count | Integer | work_item | 업무에 등록된 댓글 총 개수 |
| is_deleted | Boolean | work_item, recurring_rule | 삭제 여부 (조회 시점에는 항상 false) |
| start_date | String or Null | work_item | 업무 시작 일자 |
| due_date | String or Null | work_item | 업무 마감 일자 |
| rule_id | Integer | recurring_rule | 정기 일정 식별 id |
| creator_user_id | String | recurring_rule | 일정 생성자 id |
| assignee_user_id | String or Null | recurring_rule | 일정 담당자 id |
| frequency | String | recurring_rule | 반복 주기 (DAILY, WEEKLY, MONTHLY, YEARLY) |
| interval_value | Integer | recurring_rule | 반복 간격 (N일/N주/N개월) |
| by_day | String or Null | recurring_rule | 반복 요일 ('MO', 'TU,TH' 등) |
| by_month_day | Integer or Null | recurring_rule | 월간 반복 일자 (1~31) |
| by_set_pos | Integer or Null | recurring_rule | 월간 반복 주차 (1: 첫째 주, -1: 마지막 주) |
| start_time | String or Null | recurring_rule | 일정 시작 시간 |
| duration_minutes | Integer or Null | recurring_rule | 소요 시간(분) |
| repeat_start_date | String | recurring_rule | 반복 시작 기준일 |
| repeat_end_date | String or Null | recurring_rule | 반복 종료일 (null: 무기한) |
| max_occurrences | Integer or Null | recurring_rule | 최대 반복 횟수 |
| exclude_holidays | Boolean | recurring_rule | 공휴일 제외 여부 |
| holiday_action | String | recurring_rule | 공휴일 처리 방식 (SKIP, NEXT_WORKDAY, PREV_WORKDAY) |
| auto_create_task | Boolean | recurring_rule | 자동 업무 생성 여부 |
| is_active | Boolean | recurring_rule | 일정 활성 여부 |
| created_at | String | recurring_rule | 데이터 생성 일시 |
| updated_at | String | work_item, recurring_rule | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. WORK_ITEM은 담당자(owner_user_id)가 조회자인 업무만 반환합니다. 스코프와 무관하게 본인 업무는 항상 노출됩니다.<br>
2. 조회 범위는 `COALESCE(due_date, start_date, updated_at)` 가 오늘 - 6개월 이후인 업무입니다. 상한이 없어 마감일이 미래인 업무도 포함됩니다.<br>
3. RECURRING_RULE은 스코프에 속한 정기 일정 중 삭제되지 않은 항목 전체입니다. `is_active` 값은 그대로 내려주고 노출 여부는 클라이언트가 판단합니다.<br>
4. `today`, `week_start_date`, `week_end_date` 는 Asia/Seoul 기준으로 계산하며 주 시작은 월요일입니다.<br>
5. 진행 중 업무 수, 오늘 마감 건수, 이번 주 진행률 같은 요약 수치는 위 업무 목록에서 클라이언트가 계산합니다.<br>
6. 일정의 다음 발생 일시는 응답에 포함되지 않습니다. 클라이언트의 반복 규칙 계산 로직으로 산출합니다.<br>
7. 사용자가 존재하지 않으면 404와 `요청자를 찾을 수 없습니다.` 메시지가, 조회 중 오류가 나면 500과 `대시보드 데이터를 불러오지 못했습니다.` 메시지가 반환됩니다.<br>
