import path from 'node:path'
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { fileURLToPath } from 'node:url'
import { WINDOW_CONTROL_CHANNELS } from '../ipc/windowControls'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
const isWindows = process.platform === 'win32'

function getSenderWindow(sender: Electron.WebContents) {
  return BrowserWindow.fromWebContents(sender)
}

function sendMaximizeState(targetWindow: BrowserWindow | null) {
  if (!targetWindow || targetWindow.isDestroyed()) {
    return
  }

  targetWindow.webContents.send(WINDOW_CONTROL_CHANNELS.maximizeChanged, targetWindow.isMaximized())
}

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

function createWindow() {
  win = new BrowserWindow({
    autoHideMenuBar: true,
    frame: !isWindows,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  Menu.setApplicationMenu(null)

  if (isWindows) {
    const syncMaximizeState = () => sendMaximizeState(win)

    win.on('maximize', syncMaximizeState)
    win.on('unmaximize', syncMaximizeState)
  }

  win.webContents.on('did-finish-load', () => {
    sendMaximizeState(win)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(createWindow)
