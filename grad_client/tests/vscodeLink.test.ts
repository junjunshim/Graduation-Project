import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AXIS_SHARE_EXTENSION_ID,
  buildHandoffUri,
  describeVscodeLaunchFailure,
  describeVscodeWarning,
  getVscodeScheme,
} from '../renderer/features/workspace/model/vscodeLink.js'

test('CLI 이름을 VSCode 계열 URI 스킴으로 매핑한다', () => {
  assert.equal(getVscodeScheme('code'), 'vscode')
  assert.equal(getVscodeScheme('code-insiders'), 'vscode-insiders')
  assert.equal(getVscodeScheme('codium'), 'vscodium')
  assert.equal(getVscodeScheme('cursor'), 'cursor')
  assert.equal(getVscodeScheme(null), 'vscode')
  assert.equal(getVscodeScheme('unknown-cli'), 'vscode')
})

test('핸드오프 URI 는 확장 식별자를 authority 로 쓰고 1회용 코드만 싣는다', () => {
  const uri = buildHandoffUri({ scheme: 'vscode', repoId: 3, nodeId: 12, code: 'abc123' })

  assert.equal(uri, `vscode://${AXIS_SHARE_EXTENSION_ID}/auth?repo=3&node=12&code=abc123`)

  // 코드에 예약문자가 있어도 인코딩해 쿼리를 깨뜨리지 않는다.
  const encoded = buildHandoffUri({ scheme: 'cursor', repoId: 1, nodeId: 2, code: 'a&b=c' })

  assert.equal(encoded, 'cursor://junjunshim.axis-share/auth?repo=1&node=2&code=a%26b%3Dc')
})

test('확장이 확인될 때만 미설치 경고를 띄운다', () => {
  assert.match(
    describeVscodeWarning({ status: 'installed', extensionKnown: true, extensionInstalled: false }) ?? '',
    /확장/,
  )
  assert.equal(
    describeVscodeWarning({ status: 'installed', extensionKnown: true, extensionInstalled: true }),
    null,
  )
  // 확장 목록을 못 읽었으면 설치 여부를 단정하지 않는다.
  assert.equal(
    describeVscodeWarning({ status: 'installed', extensionKnown: false, extensionInstalled: false }),
    null,
  )
  // CLI 탐지가 틀렸을 수 있으므로 URI 가 열린 경우에는 경고하지 않는다.
  assert.equal(
    describeVscodeWarning({ status: 'missing', extensionKnown: false, extensionInstalled: false }),
    null,
  )
  assert.equal(
    describeVscodeWarning({ status: 'unknown', extensionKnown: false, extensionInstalled: false }),
    null,
  )
})

test('URI 열기 실패 원인을 안내한다', () => {
  assert.match(describeVscodeLaunchFailure({ status: 'missing' }), /설치되어 있지 않은/)
  assert.match(describeVscodeLaunchFailure({ status: 'unknown' }), /열지 못했습니다/)
  assert.match(describeVscodeLaunchFailure({ status: 'installed' }), /열지 못했습니다/)
})