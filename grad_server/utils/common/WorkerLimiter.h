#pragma once

#include <condition_variable>
#include <cstddef>
#include <mutex>

namespace app_utils {

// 무거운 작업(git 실행 + 동기 DB)의 **동시 실행 수** 상한 (TASK_11 §13.4).
//
// 왜 필요한가: runOffLoop 는 요청마다 스레드를 하나 띄우고 그 안에서 git 을 fork 한다.
// 상한이 없으면 동시 요청 수만큼 스레드와 git 프로세스가 생겨 메모리가 예측 불가능해지고,
// DB 커넥션(사설 풀)이 마르면 무관한 요청까지 전부 줄을 선다.
//
// 차선(lane)을 나눠 막는다:
//   - Normal  : 파일 조회·스테이징·커밋 등 로컬 파일·DB 작업. 최대 6 (기본)
//   - Network : clone / fetch / push. 최대 2 (기본) 이고 Normal 과 **합산**된다.
//               원격 작업은 타임아웃이 분 단위라, 몇 건이 전체 자리를 다 잡으면
//               파일 트리 조회까지 그 뒤에 줄을 선다. 그래서 합산 상한을 둔다.
//   - Internal: collab 내부 API(티켓 소비·작업 경로 해석). 최대 8 (기본), 합산하지 않는다.
//               편집을 시작하는 경로라 git 작업 뒤에 서면 안 된다.
//
// 대기 줄에도 차선별 상한을 둔다(기본 32). 넘으면 기다리지 않고 즉시 거부한다 —
// 무한 대기는 스레드를 무제한 쌓는 것과 같아서 제한의 뜻이 없어진다.
//
// 기다리는 시간에도 상한을 둔다(기본 20초). 하염없이 기다리면 nginx 의 proxy_read_timeout(120초)이
// 먼저 걸려 사용자에게 504 가 나간다 — 그 전에 스스로 503 으로 거절하는 편이 낫다.
class WorkerLimiter {
public:
    // Network 는 원격 통신, Internal 은 collab 내부 API, 나머지는 Normal 이다.
    enum class Lane { Normal, Network, Internal };

    static WorkerLimiter &instance();

    // 슬롯을 잡는다. 대기 줄이 꽉 찼으면 기다리지 않고 false 를 준다(부르는 쪽이 503 으로 거부).
    // 자리가 날 때까지는 여기서 블록된다 — **IO 스레드가 아니라 워커 스레드에서** 부른다.
    bool acquire(Lane lane);

    // 슬롯을 돌려준다. acquire 가 true 를 준 경우에만 부른다.
    void release(Lane lane);

    // 지금 상태(로그·안내 문구용).
    int running() const;         // Normal + Network 동시 실행 수
    int networkRunning() const;  // 그중 원격 작업 수
    int internalRunning() const; // collab 내부 API 동시 실행 수
    int waiting() const;         // 세 차선 대기 합계

    int maxConcurrent() const;
    int maxNetwork() const;
    int maxInternal() const;
    int maxQueued() const;
    int maxWaitMs() const;

private:
    WorkerLimiter();

    bool canRunLocked(Lane lane) const;
    bool queuedFullLocked(Lane lane) const;

    mutable std::mutex mutex_;
    std::condition_variable cv_;
    int maxConcurrent_;  // 생성자에서 env 로 확정한다(원격 상한 클램프 때문에 const 로 두지 않는다)
    int maxNetwork_;
    int maxInternal_;
    int maxQueued_;
    int maxWaitMs_;
    int running_ = 0;         // Normal + Network (Network 도 여기 포함된다)
    int networkRunning_ = 0;  // running_ 에 포함
    int internalRunning_ = 0; // 합산하지 않는다
    int waiting_[3] = {0, 0, 0};
};

}  // namespace app_utils
