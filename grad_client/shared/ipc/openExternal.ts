export const OPEN_EXTERNAL_CHANNELS = {
  open: 'open-external:open',
  detectVscode: 'open-external:detect-vscode',
} as const

/**
 * VSCode 계열 CLI 탐지 결과.
 * - `installed`: CLI 를 찾았다(확장 설치 여부는 `extensionInstalled` 로 따로 본다).
 * - `missing`: VSCode 계열이 설치되어 있지 않다.
 * - `unknown`: 확인 자체를 못 했다(경로·권한 문제). 이때 UI 는 경고하지 않는다.
 */
export type VscodeEnvStatus = 'installed' | 'missing' | 'unknown'

export type VscodeDetection = {
  status: VscodeEnvStatus
  /** 탐지된 CLI 실행 이름(code, code-insiders, codium, cursor). 없으면 null */
  cli: string | null
  version: string | null
  /** 확장 목록 조회에 성공했는지. 실패하면 extensionInstalled 를 신뢰할 수 없다. */
  extensionKnown: boolean
  extensionInstalled: boolean
}

export type OpenExternalApi = {
  open: (url: string) => Promise<boolean>
  detectVscode: (extensionId: string) => Promise<VscodeDetection>
}