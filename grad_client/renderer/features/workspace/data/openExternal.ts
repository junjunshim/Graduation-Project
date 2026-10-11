import type { OpenExternalApi, VscodeDetection } from '../../../../shared/ipc/openExternal'

function getOpenExternalApi(): OpenExternalApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.openExternal ?? null
}

/**
 * Electron 메인 프로세스에 외부 앱(VSCode 등) 열기를 요청한다.
 * 브라우저처럼 지원하지 않는 환경에서는 열지 못했음을 알린다.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const api = getOpenExternalApi()

  if (!api) {
    return false
  }

  try {
    return await api.open(url)
  } catch {
    return false
  }
}

/** VSCode 설치·확장 설치 여부를 확인한다. 확인하지 못하면 status 'unknown' 이다. */
export async function detectVscodeEnvironment(extensionId: string): Promise<VscodeDetection> {
  const api = getOpenExternalApi()

  if (!api) {
    return { status: 'unknown', cli: null, version: null, extensionKnown: false, extensionInstalled: false }
  }

  try {
    return await api.detectVscode(extensionId)
  } catch {
    return { status: 'unknown', cli: null, version: null, extensionKnown: false, extensionInstalled: false }
  }
}