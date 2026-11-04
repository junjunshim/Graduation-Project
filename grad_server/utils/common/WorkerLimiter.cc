#include "WorkerLimiter.h"

#include <chrono>
#include <cstdlib>
#include <exception>
#include <string>
#include <utility>

#include <drogon/drogon.h>

namespace app_utils {

namespace {

// 양의 정수 환경변수만 받는다. 없거나 이상하면 기본값을 쓴다.
int readEnvInt(const char *key, int fallback) {
    const char *raw = std::getenv(key);
    if (raw == nullptr || *raw == 0) {
        return fallback;
    }
    try {
        const int value = std::stoi(std::string(raw));
        return value > 0 ? value : fallback;
    } catch (const std::exception &) {
        return fallback;
    }
}

// 차선 -> 배열 인덱스. waiting_ 의 크기와 enum 순서를 맞춘다.
std::size_t laneIndex(WorkerLimiter::Lane lane) {
    return static_cast<std::size_t>(lane);
}

// 차선을 늘리면 waiting_ 크기도 함께 늘려야 한다(조용한 범위 초과를 막는다).
static_assert(static_cast<int>(WorkerLimiter::Lane::Internal) + 1 == 3,
              "waiting_ 의 크기와 WorkerLimiter::Lane 의 개수를 맞춘다");

}  // namespace

WorkerLimiter &WorkerLimiter::instance() {
    // 워커 스레드가 정적 소멸 순서에 묶이지 않도록 프로세스 수명 동안 유지한다.
    static WorkerLimiter *limiter = new WorkerLimiter();
    return *limiter;
}

WorkerLimiter::WorkerLimiter() {
    maxConcurrent_ = readEnvInt("GIT_MAX_CONCURRENT", 6);
    // 원격 상한이 전체 상한보다 크면 뜻이 없다 — 둘 다 같은 자리를 두고 겨룬다.
    maxNetwork_ = readEnvInt("GIT_MAX_NETWORK", 2);
    if (maxNetwork_ > maxConcurrent_) {
        maxNetwork_ = maxConcurrent_;
    }
    maxInternal_ = readEnvInt("COLLAB_INTERNAL_MAX_CONCURRENT", 8);
    maxQueued_ = readEnvInt("GIT_MAX_QUEUED", 32);
    maxWaitMs_ = readEnvInt("GIT_MAX_WAIT_MS", 20 * 1000);

    // 요청마다 스레드를 만들지 않고, 차선별 고정 워커가 큐에서 작업을 꺼내 실행한다.
    for (int i = 0; i < maxConcurrent_; ++i) {
        workers_.emplace_back([this]() { workerLoop(Lane::Normal); });
    }
    for (int i = 0; i < maxNetwork_; ++i) {
        workers_.emplace_back([this]() { workerLoop(Lane::Network); });
    }
    for (int i = 0; i < maxInternal_; ++i) {
        workers_.emplace_back([this]() { workerLoop(Lane::Internal); });
    }
}

bool WorkerLimiter::submit(Lane lane, Task task) {
    std::lock_guard<std::mutex> lock(mutex_);
    auto &state = lanes_[laneIndex(lane)];
    if (state.queue.size() >= static_cast<std::size_t>(maxQueued_)) {
        return false;
    }
    state.queue.push_back(std::move(task));
    state.cv.notify_one();
    return true;
}

void WorkerLimiter::workerLoop(Lane lane) {
    const std::size_t index = laneIndex(lane);
    while (true) {
        Task task;
        {
            std::unique_lock<std::mutex> lock(mutex_);
            lanes_[index].cv.wait(lock, [this, index]() { return !lanes_[index].queue.empty(); });
            task = std::move(lanes_[index].queue.front());
            lanes_[index].queue.pop_front();
        }
        try {
            task();
        } catch (const std::exception &e) {
            LOG_ERROR << "[WORKER] event=task.failed lane=" << static_cast<int>(lane)
                      << " error=" << e.what();
        } catch (...) {
            LOG_ERROR << "[WORKER] event=task.failed lane=" << static_cast<int>(lane)
                      << " error=unknown";
        }
    }
}

bool WorkerLimiter::canRunLocked(Lane lane) const {
    switch (lane) {
        case Lane::Network:
            // 원격 작업도 전체 자리를 쓰므로 두 조건을 모두 만족해야 한다.
            return running_ < maxConcurrent_ && networkRunning_ < maxNetwork_;
        case Lane::Internal:
            // collab 내부 API 는 편집 시작 경로다 — git 과 자리를 겨루지 않게 따로 센다.
            return internalRunning_ < maxInternal_;
        case Lane::Normal:
        default: {
            // 원격 작업이 대기 중이면 그만큼 일반 작업 슬롯을 비워 둔다. 그러지 않으면 로컬 작업
            // 워커들이 빈자리를 계속 채가 Network 작업이 maxWaitMs 끝에 503 이 될 수 있다.
            const std::size_t networkIndex = laneIndex(Lane::Network);
            int pendingNetwork = waiting_[networkIndex] +
                                 static_cast<int>(lanes_[networkIndex].queue.size()) - networkRunning_;
            if (pendingNetwork < 0) {
                pendingNetwork = 0;
            }
            if (pendingNetwork > maxNetwork_) {
                pendingNetwork = maxNetwork_;
            }
            return running_ < maxConcurrent_ - pendingNetwork;
        }
    }
}

bool WorkerLimiter::acquire(Lane lane) {
    std::unique_lock<std::mutex> lock(mutex_);
    const std::size_t index = laneIndex(lane);
    waiting_[index] += 1;

    // 자리가 나기를 기다린다. 다만 하염없이 기다리면 nginx 의 proxy_read_timeout(120초)이 먼저
    // 걸려 504 가 나가므로 여기서 스스로 끊는다 — 그 전에 503 으로 거절하는 편이 낫다.
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(maxWaitMs_);
    bool granted = false;
    while (true) {
        if (canRunLocked(lane)) {
            granted = true;
            break;
        }
        if (cv_.wait_until(lock, deadline) == std::cv_status::timeout && !canRunLocked(lane)) {
            break;
        }
    }

    waiting_[index] -= 1;
    if (!granted) {
        return false;
    }

    switch (lane) {
        case Lane::Network:
            running_ += 1;
            networkRunning_ += 1;
            break;
        case Lane::Internal:
            internalRunning_ += 1;
            break;
        case Lane::Normal:
        default:
            running_ += 1;
            break;
    }
    return true;
}

void WorkerLimiter::release(Lane lane) {
    std::lock_guard<std::mutex> lock(mutex_);
    switch (lane) {
        case Lane::Network:
            if (running_ > 0) {
                running_ -= 1;
            }
            if (networkRunning_ > 0) {
                networkRunning_ -= 1;
            }
            break;
        case Lane::Internal:
            if (internalRunning_ > 0) {
                internalRunning_ -= 1;
            }
            break;
        case Lane::Normal:
        default:
            if (running_ > 0) {
                running_ -= 1;
            }
            break;
    }
    cv_.notify_all();
}

int WorkerLimiter::running() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return running_;
}

int WorkerLimiter::networkRunning() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return networkRunning_;
}

int WorkerLimiter::internalRunning() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return internalRunning_;
}

int WorkerLimiter::waiting() const {
    std::lock_guard<std::mutex> lock(mutex_);
    int total = waiting_[0] + waiting_[1] + waiting_[2];
    for (const auto &lane : lanes_) {
        total += static_cast<int>(lane.queue.size());
    }
    return total;
}

int WorkerLimiter::maxConcurrent() const { return maxConcurrent_; }
int WorkerLimiter::maxNetwork() const { return maxNetwork_; }
int WorkerLimiter::maxInternal() const { return maxInternal_; }
int WorkerLimiter::maxQueued() const { return maxQueued_; }
int WorkerLimiter::maxWaitMs() const { return maxWaitMs_; }

}  // namespace app_utils
