import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  OPEN_EXTERNAL_CHANNELS,
  type VscodeDetection,
} from '../../shared/ipc/openExternal'

const require = createRequire(import.meta.url)
const { ipcMain, shell } = require('electron') as typeof import('electron')

/**
 * 렌더러가 열 수 있는 외부 프로토콜을 제한한다.
 * VSCode 계열은 포크마다 스킴이 다르고(§3.4), 그 외 임의 프로토콜 실행은 막는다.
 */
const ALLOWED_PROTOCOLS = new Set([
  'vscode:',
  'vscode-insiders:',
  'vscodium:',
  'cursor:',
  'https:',
])

/** PATH 에 등록되지 않은 설치가 흔해 후보를 순서대로 시도한다. */
const VSCODE_CANDIDATES = ['code', 'code-insiders', 'codium', 'cursor']

const CLI_TIMEOUT_MS = 5_000

function unknownDetection(): VscodeDetection {
  return { status: 'unknown', cli: null, version: null, extensionKnown: false, extensionInstalled: false }
}

/** CLI 를 실행하고 stdout 을 돌려준다. 실패하면 null(설치 없음 또는 실행 불가). */
function runCli(cli: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      cli,
      args,
      // Windows 에서 code 는 code.cmd 라 shell 없이는 실행되지 않는다.
      // 인자는 상수만 넘기므로 주입 위험은 없다.
      { timeout: CLI_TIMEOUT_MS, windowsHide: true, shell: process.platform === 'win32' },
      (error, stdout) => resolve(error ? null : stdout),
    )
  })
}

async function detectVscode(extensionId: string): Promise<VscodeDetection> {
  for (const cli of VSCODE_CANDIDATES) {
    const versionOutput = await runCli(cli, ['--version'])

    if (versionOutput === null) {
      continue
    }

    const extensionList = await runCli(cli, ['--list-extensions'])
    const extensionInstalled =
      extensionList !== null &&
      extensionList
        .split(/\r?\n/)
        .some((line) => line.trim().toLowerCase() === extensionId.toLowerCase())

    return {
      status: 'installed',
      cli,
      version: versionOutput.split(/\r?\n/)[0]?.trim() || null,
      extensionKnown: extensionList !== null,
      extensionInstalled,
    }
  }

  return { status: 'missing', cli: null, version: null, extensionKnown: false, extensionInstalled: false }
}

export function registerOpenExternalHandlers() {
  ipcMain.handle(OPEN_EXTERNAL_CHANNELS.open, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url.trim()) {
      return false
    }

    let protocol: string
    try {
      protocol = new URL(url).protocol
    } catch {
      return false
    }

    if (!ALLOWED_PROTOCOLS.has(protocol)) {
      return false
    }

    try {
      await shell.openExternal(url)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(OPEN_EXTERNAL_CHANNELS.detectVscode, async (_event, extensionId: unknown) => {
    const id = typeof extensionId === 'string' ? extensionId.trim() : ''

    if (!id) {
      return unknownDetection()
    }

    try {
      return await detectVscode(id)
    } catch {
      return unknownDetection()
    }
  })
}