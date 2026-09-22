# node 이전 api
- 워크스페이스(node)를 다른 워크스페이스 하위로 옮기거나 루트로 분리하는 api
- 이름·유형을 수정하는 `PATCH /api/org/nodes`와 별도 기능이며, 사전 검사 후 실행하는 2단계로 동작한다.
## Request

### 사전 검사

- Request Syntax
```json
{
    "node_id" : 12,
    "parent_node_id" : 30
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/org/nodes/move-preview |

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
| node_id | Integer | 필수 | 이전할 대상 node 식별 id |
| parent_node_id | Integer or Null | 필수 | 이전할 목적지 node 식별 id (null이면 루트로 분리) |

### 실행

- Request Syntax

담당자별 이관
```json
{
    "node_id" : 12,
    "parent_node_id" : 30,
    "preview_token" : "사전 검사에서 반환한 값",
    "transfers" : {
        "U-163" : "new1@example.com",
        "U-201" : "new2@example.com"
    }
}
```

전체 이관
```json
{
    "node_id" : 12,
    "parent_node_id" : null,
    "preview_token" : "사전 검사에서 반환한 값",
    "new_owner_email" : "new@example.com"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/org/nodes/move |

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
| node_id | Integer | 필수 | 이전할 대상 node 식별 id |
| parent_node_id | Integer or Null | 필수 | 이전할 목적지 node 식별 id (null이면 루트로 분리) |
| preview_token | String | 필수 | 사전 검사에서 반환한 검사 결과 버전 |
| transfers | Object | 선택 | 담당자별 이관 대상 (키: 기존 담당자 user id, 값: 새 담당자 email) |
| new_owner_email | String | 선택 | 이관 대상 업무 전체를 맡을 새 담당자 email |

- `transfers`와 `new_owner_email`은 함께 보낼 수 없다. 이관할 업무가 없으면 `transfers`를 생략하거나 `{}`로 보낸다.

---

## Response
- Response Syntax

사전 검사 성공
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE_MOVE_PREVIEW",
            "node_id" : 12,
            "parent_node_id" : 30,
            "old_parent_node_id" : 11,
            "preview_token" : "9f2c1b7a4e5d83c6a1b0f9e8d7c6b5a4",
            "nodes" : [
                {
                    "node_id" : 12,
                    "name" : "백엔드 개발",
                    "parent_node_id" : 11,
                    "path" : [1, 11, 12],
                    "new_path" : [1, 30, 12],
                    "is_deleted" : false
                }
            ],
            "owner_groups" : [
                {
                    "user_id" : "U-163",
                    "name" : "김OO",
                    "email" : "owner@example.com",
                    "work_items" : [
                        {
                            "work_item_id" : "WI-104",
                            "title" : "API 명세 정리",
                            "owner_node_id" : 12,
                            "owner_node_name" : "백엔드 개발",
                            "hidden" : false,
                            "status" : "todo"
                        }
                    ],
                    "transfer_targets" : [
                        { "user_id" : "U-201", "name" : "이OO", "email" : "new1@example.com" }
                    ]
                }
            ],
            "all_transfer_targets" : [
                { "user_id" : "U-201", "name" : "이OO", "email" : "new1@example.com" }
            ],
            "cleared_schedules" : [
                {
                    "rule_id" : 7,
                    "title" : "주간 회의",
                    "owner_node_id" : 12,
                    "assignee_user_id" : "U-163"
                }
            ],
            "detached_work_item_ids" : [ "WI-100" ],
            "can_move" : true
        }
    ]
}
```

실행 성공
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE_MOVE_RESULT",
            "node_id" : 12,
            "parent_node_id" : 30,
            "transferred_work_item_count" : 1,
            "cleared_schedule_count" : 1,
            "detached_work_item_count" : 1
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
| data | Array | 성공 | 사전 검사는 NODE_MOVE_PREVIEW, 실행은 NODE_MOVE_RESULT 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements (사전 검사)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE_MOVE_PREVIEW) |
| node_id | Integer | 필수 | 이전 대상 node 식별 id |
| parent_node_id | Integer or Null | 필수 | 요청한 목적지 node 식별 id (null이면 루트) |
| old_parent_node_id | Integer or Null | 필수 | 이전 전 상위 node 식별 id (null이면 루트) |
| preview_token | String | 필수 | 실행 요청에 전달할 검사 결과 버전 (데이터 변경 감지용 지문) |
| nodes | Array | 필수 | 이전 대상과 모든 자손 노드 목록 |
| owner_groups | Array | 필수 | 담당자별 이관 대상 업무와 이관 후보 목록 |
| all_transfer_targets | Array | 필수 | 모든 이관 대상 업무를 수행할 수 있는 사용자 교집합 |
| cleared_schedules | Array | 필수 | 담당자를 미정으로 변경할 일정 목록 |
| detached_work_item_ids | Array | 필수 | 기존 부모 공간의 업무와 연결을 해제할 업무 id 목록 |
| can_move | Boolean | 필수 | 다른 목적지이고 모든 담당자 그룹에 이관 후보가 있는지 |

- nodes Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| node_id | Integer | 필수 | 노드 식별 id |
| name | String | 필수 | 노드 이름 |
| parent_node_id | Integer or Null | 필수 | 현재 상위 node 식별 id |
| path | Array | 필수 | 현재 계층 경로 배열 |
| new_path | Array | 필수 | 이전 후 계층 경로 배열 |
| is_deleted | Boolean | 필수 | 삭제 여부 |

- owner_groups Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 기존 담당자 user id |
| name | String | 필수 | 기존 담당자 이름 |
| email | String | 필수 | 기존 담당자 email |
| work_items | Array | 필수 | 해당 담당자가 맡은 이관 대상 업무 목록 |
| transfer_targets | Array | 필수 | 해당 담당자의 업무를 맡을 수 있는 사용자 목록 |

- work_items Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| work_item_id | String | 필수 | 업무 식별 id |
| title | String | 필수 | 업무 제목 (숨김 업무 조회 권한이 없으면 "숨김 업무") |
| owner_node_id | Integer | 필수 | 업무 소속 node 식별 id |
| owner_node_name | String | 필수 | 업무 소속 node 이름 |
| hidden | Boolean | 필수 | 숨김 업무 여부 |
| status | String | 필수 | 업무 상태값 |

- transfer_targets Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 사용자 id |
| name | String | 필수 | 사용자 이름 |
| email | String | 필수 | 사용자 email |

- cleared_schedules Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| rule_id | Integer | 필수 | 반복 일정 식별 id |
| title | String | 필수 | 일정 제목 |
| owner_node_id | Integer | 필수 | 일정 소속 node 식별 id |
| assignee_user_id | String | 필수 | 담당자를 해제할 user id |

- Data Elements (실행)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE_MOVE_RESULT) |
| node_id | Integer | 필수 | 이전한 node 식별 id |
| parent_node_id | Integer or Null | 필수 | 이전 후 상위 node 식별 id (null이면 루트) |
| transferred_work_item_count | Integer | 필수 | 이관한 미완료 업무 수 |
| cleared_schedule_count | Integer | 필수 | 담당자를 미정으로 변경한 일정 수 |
| detached_work_item_count | Integer | 필수 | 기존 부모 공간의 업무와 연결을 해제한 업무 수 |

## 정책
- 요청자는 이전 대상에 **직접** `NODE_INFO_CHANGE` 권한이 있어야 한다.
- 목적지가 있으면 그 공간에 `NODE_SUB_CREATE` 권한이 필요하며 상속도 인정한다.
- 기존 부모의 별도 승인은 요구하지 않는다.
- 개인 공간, 삭제된 공간, 자기 자신, 자신의 자손 아래로의 이전은 거부한다.
- 전체 하위 트리를 이동하고, 직접 역할과 업무·일정·파일의 소속 워크스페이스 id를 유지한다.
- 기존 부모 공간의 업무에 연결된 업무는 부모를 해제하고 최상위 업무로 만든다 (`weight=0`). 내부 업무 연결은 유지한다.
- 외부 조상에 의존하던 담당자가 새 경로에서 업무 수행 자격을 잃으면 미완료 업무만 이관한다. 완료 업무 담당자는 유지한다.
- 새 담당자는 맡을 **모든** 업무 공간에서 `WI_PERSONAL_CHANGE`, 숨김 업무에는 `WI_HIDDEN_CHANGE`도 필요하다. 역할 회수와 같은 기준이다.
- 일정은 역할 회수처럼 담당자를 `NULL`로 변경하며 반복 설정은 유지한다.
- 삭제된 자손도 경로를 갱신한다. 삭제된 업무·일정의 담당자는 역할 회수와 동일하게 이관 대상에서 제외한다.
- 사전 검사는 데이터를 변경하지 않는다. 같은 부모를 목적지로 선택하면 미리보기는 허용되지만 `can_move`는 false이다.
- 숨김 업무 조회 권한이 없는 요청자에게는 해당 업무 제목을 "숨김 업무"로 표시한다.
- 목적지·권한·담당 업무 등을 실행 시 다시 검사한다. 사전 검사 후 관련 데이터가 변경되면 HTTP 409 (`P0321`)로 재검사를 요구한다.
- 트리 경로, 업무 이관, 일정 담당자 해제, 부모 연결 해제는 단일 트랜잭션으로 처리한다.
