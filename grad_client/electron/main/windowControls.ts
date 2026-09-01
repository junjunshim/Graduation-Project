import { createRequire } from 'node:module'
import type { BrowserWindow as BrowserWindowType, WebContents } from 'electron'
import { WINDOW_CONTROL_CHANNELS } from '../../shared/ipc/windowControls'

const require = createRequire(import.meta.url)
const { BrowserWindow, ipcMain } = require('electron') as typeof import('electron')

function getSenderWindow(sender: WebContents) {
  return BrowserWindow.fromWebContents(sender)
}

export function sendWindowMaximizeState(targetWindow: BrowserWindowType | null) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }

  targetWindow.webContents.send(WINDOW_CONTROL_CHANNELS.maximizeChanged, targetWindow.isMaximized())
}

export function watchWindowMaximizeState(targetWindow: BrowserWindowType) {
  const syncMaximizeState = () => sendWindowMaximizeState(targetWindow)

  targetWindow.on('maximize', syncMaximizeState)
  targetWindow.on('unmaximize', syncMaximizeState)
}

export function registerWindowControlHandlers() {
  ipcMain.on(WINDOW_CONTROL_CHANNELS.minimize, (event) => {
    getSenderWindow(event.sender)?.minimize()
  })

  ipcMain.on(WINDOW_CONTROL_CHANNELS.toggleMaximize, (event) => {
    const senderWindow = getSenderWindow(event.sender)

    if (!senderWindow) {
      return
    }

    if (senderWindow.isMaximized()) {
      senderWindow.unmaximize()
      return
    }

    senderWindow.maximize()
  })

  ipcMain.on(WINDOW_CONTROL_CHANNELS.close, (event) => {
    getSenderWindow(event.sender)?.close()
  })

  ipcMain.handle(WINDOW_CONTROL_CHANNELS.isMaximized, (event) => {
    return getSenderWindow(event.sender)?.isMaximized() ?? false
  })
}
