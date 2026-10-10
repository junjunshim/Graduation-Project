#pragma once

#include <json/json.h>

#include <string>
#include <vector>

namespace app_utils
{
/**
 * collab 사이드카에 통보할 사용자 한 명의 권한 (TASK_11 §12.9).
 *
 * 두 값의 뜻이 다르다 — `canWrite=false` 는 그 세션을 읽기 전용으로 바꾸는 것이고,
 * `canView=false` 는 그 세션을 **끝내는** 것이다(강제 이탈). `canView` 의 기본값을 true 로 둔
 * 이유는, 값을 안 보내 온 통보로 남의 세션을 끊지 않기 위해서다.
 */
struct CollabPermissionEntry {
    std::string userEmail;
    bool canView = true;
    bool canWrite = false;
};

/**
 * collab 내부 API 를 부르고 **응답을 기다린다** (§12.11, §12.11.1).
 *
 * 왜 기다리는가: 되돌리기·커밋은 "collab 이 파일을 내려쓴 뒤에 git 을 돌려야" 하기 때문이다.
 *   - 되돌리기: git 은 체크아웃할 때 그 경로가 비어 있다고 본 뒤 O_CREAT|O_EXCL 로 새로 만든다.
 *     그 사이에 collab 이 같은 경로를 쓰면 `unable to create file <path>: File exists` 로 죽는다(실측).
 *   - 커밋: 편집은 디바운스(기본 2초) 뒤에 파일로 내려가므로, 안 기다리면 마지막 편집이 빠진 채 커밋된다.
 * collab 이 없거나 제때 응답하지 않으면 false 를 돌려주고 호출자는 그대로 진행한다 — collab 이 죽어
 * 있어도 되돌리기·커밋 자체를 실패시키지 않는다(그때는 메모리에 doc 이 없어 내려쓸 것도 없다).
 * outData 를 넘기면 200 응답의 `data` 배열을 그대로 담아 준다 — 커밋 전 flush 가 `failed` 를 보는
 * 경로가 쓴다(§9.8). 응답을 못 받았거나 200 이 아니면 outData 는 건드리지 않는다.
 *
 * COLLAB_BASE·INTERNAL_TOKEN 이 없으면 아무것도 하지 않고 false 를 돌려준다(fail-closed).
 * 이 함수는 내부 루프에 작업을 올리고 그 스레드에서 응답을 기다리므로, **이벤트 루프 스레드에서
 * 부르면 안 된다**(루프가 막힌다). 워커 스레드에서만 부른다.
 */
bool callCollabInternal(const std::string &path, const Json::Value &body, Json::Value *outData = nullptr);

/**
 * 저장소 하나의 권한 변경을 collab 에게 알린다 (§12.9).
 *
 * collab 은 이 통보를 받아 그 저장소 방의 해당 세션에 반영한다 — `canWrite` 가 바뀌면 `perm`
 * 프레임을 보내고(값이 그대로면 보내지 않는다), `canView=false` 면 **그 세션을 끝낸다.**
 * 읽기만 막고 남겨 두면 못 보게 된 저장소의 편집을 계속 받기 때문이다.
 */
void notifyPermissionChanged(int repoId, const std::vector<CollabPermissionEntry> &users);

/**
 * 저장소가 통째로 사라졌을 때(노드 삭제) collab 에게 그 저장소의 문서 세션을 닫으라고 알린다
 * (TASK_11 §12.9).
 *
 * 노드 삭제는 소프트 딜리트라 저장소 행이 남는다. 그래서 "지금 붙어 있는 세션을 끊는 일"과
 * "다시 못 붙게 막는 일"을 나눠서 한다 — 여기서는 전자만 한다(후자는 접속 등록 P0815 와
 * 경로 해석 P0815 가 막는다). collab 은 그 저장소의 모든 방을 파일로 내려쓴 뒤(편집 보존)
 * 접속자에게 `repo_closed` 를 보내고 소켓을 닫는다.
 *
 * 부르는 쪽(노드 삭제)의 HTTP 응답을 늦추지 않도록 워커 스레드에서 부른다 — 통보 자체는
 * collab 이 응답할 때까지(최대 3초) 그 스레드에서 기다린다. 실패해도 제어 소켓이 끊기면서
 * 세션은 어차피 정리된다.
 */
void notifyReposClosed(const std::vector<int> &repoIds, const std::string &reason);

}  // namespace app_utils