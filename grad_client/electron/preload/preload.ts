import { contextBridge, ipcRenderer } from 'electron'
import { WINDOW_CONTROL_CHANNELS } from '../../shared/ipc/windowControls'
import { DOWNLOAD_CHANNELS, type DownloadCompletionPayload } from '../../shared/ipc/downloads'
import { OPEN_EXTERNAL_CHANNELS } from '../../shared/ipc/openExternal'
import { CHANNEL_POPUP_CHANNELS } from '../../shared/ipc/channelPopup'

if (process.platform === 'win32') {
  contextBridge.exposeInMainWorld('windowControls', {
    minimize() {
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.minimize)
    },
    toggleMaximize() {
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.toggleMaximize)
    },
    close() {
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.close)
    },
    isMaximized() {
      return ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.isMaximized)
    },
    onMaximizeChange(listener: (isMaximized: boolean) => void) {
      const wrappedListener = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
        listener(isMaximized)
      }

      ipcRenderer.on(WINDOW_CONTROL_CHANNELS.maximizeChanged, wrappedListener)

      return () => {
        ipcRenderer.off(WINDOW_CONTROL_CHANNELS.maximizeChanged, wrappedListener)
      }
    },
  })
}

contextBridge.exposeInMainWorld('openExternal', {
  open(url: string) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_CHANNELS.open, url)
  },
  detectVscode(extensionId: string) {
    return ipcRenderer.invoke(OPEN_EXTERNAL_CHANNELS.detectVscode, extensionId)
  },
})

contextBridge.exposeInMainWorld('channelPopup', {
  open(channelId: number) {
    return ipcRenderer.invoke(CHANNEL_POPUP_CHANNELS.open, channelId)
  },
  onChannelChange(listener: (channelId: number) => void) {
    const wrappedListener = (_event: Electron.IpcRendererEvent, channelId: number) => {
      listener(channelId)
    }

    ipcRenderer.on(CHANNEL_POPUP_CHANNELS.channelChanged, wrappedListener)

    return () => {
      ipcRenderer.off(CHANNEL_POPUP_CHANNELS.channelChanged, wrappedListener)
    }
  },
})

contextBridge.exposeInMainWorld('downloads', {
  onComplete(listener: (payload: DownloadCompletionPayload) => void) {
    const wrappedListener = (
      _event: Electron.IpcRendererEvent,
      payload: DownloadCompletionPayload,
    ) => {
      listener(payload)
    }

    ipcRenderer.on(DOWNLOAD_CHANNELS.completed, wrappedListener)

    return () => {
      ipcRenderer.off(DOWNLOAD_CHANNELS.completed, wrappedListener)
    }
  },
})
