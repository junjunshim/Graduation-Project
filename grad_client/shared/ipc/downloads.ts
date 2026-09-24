export const DOWNLOAD_CHANNELS = {
  completed: 'downloads:completed',
} as const

export type DownloadCompletionState = 'completed' | 'cancelled' | 'interrupted'

export type DownloadCompletionPayload = {
  fileName: string
  state: DownloadCompletionState
  savePath?: string
}

export type DownloadsApi = {
  onComplete: (listener: (payload: DownloadCompletionPayload) => void) => VoidFunction
}
