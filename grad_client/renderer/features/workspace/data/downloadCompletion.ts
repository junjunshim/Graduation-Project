import type { DownloadCompletionPayload, DownloadsApi } from '../../../../shared/ipc/downloads'

type PendingDownload = {
  fileName: string
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof globalThis.setTimeout> | null
}

/** 완료 이벤트를 못 받은 경우에도 UI가 멈추지 않도록 두는 안전 대기 시간 */
const DOWNLOAD_COMPLETION_TIMEOUT_MS = 60_000

const pendingDownloads: PendingDownload[] = []
let unsubscribeFromDownloads: VoidFunction | null = null

function getDownloadsApi(): DownloadsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.downloads ?? null
}

function finishPendingDownload(payload: DownloadCompletionPayload) {
  if (pendingDownloads.length === 0) {
    return
  }

  const matchedIndex = pendingDownloads.findIndex((pending) => pending.fileName === payload.fileName)
  const [pending] = pendingDownloads.splice(matchedIndex >= 0 ? matchedIndex : 0, 1)

  if (pending.timer) {
    globalThis.clearTimeout(pending.timer)
  }

  if (payload.state === 'completed') {
    pending.resolve()
    return
  }

  pending.reject(
    new Error(
      payload.state === 'cancelled' ? '다운로드가 취소되었습니다.' : '다운로드가 중단되었습니다.',
    ),
  )
}

function ensureDownloadSubscription(api: DownloadsApi) {
  if (unsubscribeFromDownloads) {
    return
  }

  unsubscribeFromDownloads = api.onComplete(finishPendingDownload)
}

/**
 * Electron 메인 프로세스가 알려주는 실제 다운로드 완료 시점까지 기다린다.
 * 완료 추적을 지원하지 않는 환경(브라우저)에서는 즉시 완료로 처리한다.
 */
export function waitForDownloadCompletion(fileName: string): Promise<void> {
  const api = getDownloadsApi()

  if (!api) {
    return Promise.resolve()
  }

  ensureDownloadSubscription(api)

  return new Promise<void>((resolve, reject) => {
    const pending: PendingDownload = { fileName, resolve, reject, timer: null }

    pending.timer = globalThis.setTimeout(() => {
      const index = pendingDownloads.indexOf(pending)

      if (index >= 0) {
        pendingDownloads.splice(index, 1)
      }

      resolve()
    }, DOWNLOAD_COMPLETION_TIMEOUT_MS)

    pendingDownloads.push(pending)
  })
}
