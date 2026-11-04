import path from 'node:path'
import { createRequire } from 'node:module'
import type { BrowserWindow as BrowserWindowType } from 'electron'
import { fileURLToPath } from 'node:url'
import { CHANNEL_POPUP_CHANNELS } from '../../shared/ipc/channelPopup'
import {
  sendWindowMaximizeState,
  watchWindowMaximizeState,
} from './windowControls'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { BrowserWindow, ipcMain } = require('electron') as typeof import('electron')

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
const RENDERER_DIST = path.join(__dirname, '..', 'dist')
const PRELOAD_PATH = path.join(__dirname, 'preload.mjs')

let channelPopupWindow: BrowserWindowType | null = null

function normalizeChannelId(value: unknown) {
  const channelId = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(channelId) && channelId > 0 ? channelId : null
}

function buildPopupRoute(channelId: number) {
  return `/channels/popup?channelId=${encodeURIComponent(String(channelId))}`
}

function loadChannelPopup(target: BrowserWindowType, channelId: number) {
  const route = buildPopupRoute(channelId)

  if (DEV_SERVER_URL) {
    void target.loadURL(`${DEV_SERVER_URL.replace(/\/+$/, '')}/#${route}`)
    return
  }

  void target.loadFile(path.join(RENDERER_DIST, 'index.html'), { hash: route })
}

function sendChannelChange(channelId: number) {
  const target = channelPopupWindow
  if (!target || target.isDestroyed()) return

  const send = () => {
    if (!target.isDestroyed()) {
      target.webContents.send(CHANNEL_POPUP_CHANNELS.channelChanged, channelId)
    }
  }

  if (target.webContents.isLoadingMainFrame()) {
    target.webContents.once('did-finish-load', send)
    return
  }

  send()
}

function createChannelPopup(channelId: number) {
  const popup = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    frame: process.platform !== 'win32',
    title: 'Axis - 채널',
    webPreferences: {
      preload: PRELOAD_PATH,
    },
  })

  channelPopupWindow = popup

  if (process.platform === 'win32') {
    watchWindowMaximizeState(popup)
  }

  popup.webContents.once('did-finish-load', () => {
    sendWindowMaximizeState(popup)
  })

  popup.once('ready-to-show', () => {
    if (!popup.isDestroyed()) {
      popup.show()
    }
  })

  popup.on('closed', () => {
    if (channelPopupWindow === popup) {
      channelPopupWindow = null
    }
  })

  loadChannelPopup(popup, channelId)
}

export function closeChannelPopupWindow() {
  const popup = channelPopupWindow
  channelPopupWindow = null

  if (popup && !popup.isDestroyed()) {
    popup.close()
  }
}

export function registerChannelPopupHandlers() {
  ipcMain.handle(CHANNEL_POPUP_CHANNELS.open, (_event, rawChannelId: unknown) => {
    const channelId = normalizeChannelId(rawChannelId)
    if (channelId === null) {
      return false
    }

    if (channelPopupWindow && !channelPopupWindow.isDestroyed()) {
      if (channelPopupWindow.isMinimized()) {
        channelPopupWindow.restore()
      }
      channelPopupWindow.show()
      channelPopupWindow.focus()
      sendChannelChange(channelId)
      return true
    }

    createChannelPopup(channelId)
    return true
  })
}
