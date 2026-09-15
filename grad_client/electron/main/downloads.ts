import { createRequire } from 'node:module'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { DOWNLOAD_CHANNELS, type DownloadCompletionPayload } from '../../shared/ipc/downloads'

const require = createRequire(import.meta.url)
const { session } = require('electron') as typeof import('electron')

/**
 * 렌더러가 시작한 파일 다운로드가 실제로 저장 완료(또는 취소/중단)된 시점을
 * 렌더러에 전달한다. 저장 위치 선택 창에서 취소한 경우도 함께 알린다.
 */
export function watchDownloadCompletion(getWindow: () => BrowserWindowType | null) {
  session.defaultSession.on('will-download', (_event, item) => {
    item.once('done', (_doneEvent, state) => {
      const targetWindow = getWindow()

      if (!targetWindow || targetWindow.isDestroyed()) {
        return
      }

      const payload: DownloadCompletionPayload = {
        fileName: item.getFilename(),
        state,
      }

      const savePath = item.getSavePath()

      if (savePath) {
        payload.savePath = savePath
      }

      targetWindow.webContents.send(DOWNLOAD_CHANNELS.completed, payload)
    })
  })
}
