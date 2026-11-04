export type CoalescedTask = {
  schedule: () => void
  cancel: () => void
}

type CoalescedTaskOptions = {
  delayMs: number
  onError?: (error: unknown) => void
}

/**
 * 짧은 간격의 요청을 하나로 합치고, 실행 중 들어온 요청은 완료 뒤 한 번만 다시 실행한다.
 * 서버 변경 알림처럼 같은 작업을 여러 경로에서 연속으로 요청할 수 있는 경우에 사용한다.
 */
export function createCoalescedTask(
  run: () => Promise<unknown> | void,
  options: CoalescedTaskOptions,
): CoalescedTask {
  let timer: ReturnType<typeof setTimeout> | null = null
  let isRunning = false
  let isRerunRequested = false

  async function execute() {
    if (isRunning) {
      isRerunRequested = true
      return
    }

    isRunning = true
    try {
      await run()
    } catch (error) {
      options.onError?.(error)
    } finally {
      isRunning = false
      if (isRerunRequested) {
        isRerunRequested = false
        schedule()
      }
    }
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer)
    }

    timer = setTimeout(() => {
      timer = null
      void execute()
    }, Math.max(0, options.delayMs))
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    isRerunRequested = false
  }

  return { schedule, cancel }
}
