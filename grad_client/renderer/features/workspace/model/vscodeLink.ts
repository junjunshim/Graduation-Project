import type { VscodeEnvStatus } from '../../../../shared/ipc/openExternal'

/** 확장 식별자 = publisher.name. URI authority 로도 쓴다(§3.4, §15.13). */
export const AXIS_SHARE_EXTENSION_ID = 'junjunshim.axis-share'

/** CLI 이름 → VSCode 계열 URI 스킴. 포크는 스킴이 달라 그대로 매핑한다(§3.4). */
const SCHEME_BY_CLI: Record<string, string> = {
  code: 'vscode',
  'code-insiders': 'vscode-insiders',
  codium: 'vscodium',
  cursor: 'cursor',
}

export function getVscodeScheme(cli: string | null | undefined) {
  if (!cli) {
    return 'vscode'
  }

  return SCHEME_BY_CLI[cli] ?? 'vscode'
}

/**
 * 앱 → 확장 핸드오프 URI 를 만든다.
 * 토큰이 아니라 1회용 코드만 싣는다(§3.4) — URL 에 남아도 재사용할 수 없다.
 */
export function buildHandoffUri(params: {
  scheme: string
  repoId: number
  nodeId: number
  code: string
}) {
  const query = new URLSearchParams({
    repo: String(params.repoId),
    node: String(params.nodeId),
    code: params.code,
  })

  return `${params.scheme}://${AXIS_SHARE_EXTENSION_ID}/auth?${query.toString()}`
}

/**
 * 실행은 됐지만 확장이 빠졌을 때의 경고. 경고가 없으면 null.
 * CLI 탐지가 'missing' 인데 URI 가 열렸다면 탐지가 틀린 것이므로 경고하지 않는다.
 */
export function describeVscodeWarning(detection: {
  status: VscodeEnvStatus
  extensionKnown: boolean
  extensionInstalled: boolean
}) {
  if (detection.status === 'installed' && detection.extensionKnown && !detection.extensionInstalled) {
    return 'VSCode 확장(Axis Share)이 설치되어 있지 않습니다. 마켓플레이스에서 설치한 뒤 다시 시도해 주세요.'
  }

  return null
}

/** URI 열기에 실패했을 때 원인 후보를 안내한다. */
export function describeVscodeLaunchFailure(detection: { status: VscodeEnvStatus }) {
  if (detection.status === 'missing') {
    return 'VSCode 가 설치되어 있지 않은 것 같습니다. 설치한 뒤 다시 시도해 주세요.'
  }

  return 'VSCode 를 열지 못했습니다. VSCode 설치와 URI 연결(기본 앱)을 확인해 주세요.'
}