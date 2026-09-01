export type ServerEntityIdPrefix = 'U' | 'WI'

export function createServerEntityId(prefix: ServerEntityIdPrefix) {
  const cryptoApi = globalThis.crypto

  if (!cryptoApi || typeof cryptoApi.randomUUID !== 'function') {
    throw new Error('이 환경에서는 서버용 고유 ID를 안전하게 생성할 수 없습니다.')
  }

  return `${prefix}-${cryptoApi.randomUUID()}`
}
