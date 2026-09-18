import { apiRequest, getServerSessionEmail } from '../../workspace/data/server/apiClient'
import {
  isServerStatusResponse,
  parseServerContextItems,
  type ServerContextResponse,
} from '../../workspace/data/server/apiTypes'
import { adaptDashboardContext } from '../model/dashboardAdapter'
import type { DashboardContext } from '../model/dashboardTypes'

const DASHBOARD_CONTEXT_PATH = '/context/dashboard'

type CachedDashboardContext = {
  /** 캐시를 만든 사용자 세션 키 */
  key: string
  context: DashboardContext
}

let cachedDashboardContext: CachedDashboardContext | null = null
let inFlightDashboardRequest: Promise<DashboardContext> | null = null

/** 같은 사용자 세션에서만 캐시를 재사용한다. */
function resolveDashboardCacheKey() {
  return `server:${getServerSessionEmail() ?? ''}`
}

/**
 * 마지막으로 불러온 대시보드 데이터.
 * 대시보드는 진입할 때마다 다시 조회하므로, 재진입 시 로딩 화면 없이 이 값을 먼저 그린 뒤 갱신한다.
 */
export function readCachedDashboardContext(): DashboardContext | null {
  if (!cachedDashboardContext || cachedDashboardContext.key !== resolveDashboardCacheKey()) {
    // 다른 사용자의 데이터는 남겨두지 않는다.
    cachedDashboardContext = null
    return null
  }

  return cachedDashboardContext.context
}

/** 대시보드 전용 컨텍스트 조회. 앱 시작 시 쓰는 /context/init 과 달리 대시보드 진입 시에만 호출된다. */
export async function fetchDashboardContext(): Promise<DashboardContext> {
  const response = await apiRequest<unknown>(DASHBOARD_CONTEXT_PATH)

  if (!isServerStatusResponse(response)) {
    throw new Error('대시보드 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '대시보드 정보를 불러오지 못했습니다.')
  }

  const items = parseServerContextItems((response as ServerContextResponse).data)

  return adaptDashboardContext(items)
}

export async function loadDashboardContext(): Promise<DashboardContext> {
  // 같은 순간에 여러 번 호출되면(StrictMode 중복 마운트 등) 요청 하나를 공유한다.
  if (inFlightDashboardRequest) {
    return inFlightDashboardRequest
  }

  const cacheKey = resolveDashboardCacheKey()
  const request = (async () => {
    const context = await fetchDashboardContext()

    // 새 응답은 이전 결과와 병합하지 않고 통째로 교체한다 (사라진 업무/일정도 그대로 반영).
    cachedDashboardContext = { key: cacheKey, context }
    return context
  })()

  inFlightDashboardRequest = request

  try {
    return await request
  } finally {
    if (inFlightDashboardRequest === request) {
      inFlightDashboardRequest = null
    }
  }
}
