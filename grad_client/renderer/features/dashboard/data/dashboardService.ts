import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { readCachedRecurringRules } from '../../workspace/data/recurringRuleService'
import { apiRequest, getServerSessionEmail, hasServerSession } from '../../workspace/data/server/apiClient'
import {
  isServerStatusResponse,
  parseServerContextItems,
  type ServerContextResponse,
} from '../../workspace/data/server/apiTypes'
import { getCurrentSessionUserId } from '../../workspace/data/session'
import { getWorkspaceDataSource } from '../../workspace/data/server/workspaceMode'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { adaptDashboardContext } from '../model/dashboardAdapter'
import type { DashboardContext } from '../model/dashboardTypes'

const DASHBOARD_CONTEXT_PATH = '/context/dashboard'

type CachedDashboardContext = {
  /** 캐시를 만든 세션 키 (데이터 소스 + 사용자) */
  key: string
  context: DashboardContext
}

let cachedDashboardContext: CachedDashboardContext | null = null
let inFlightDashboardRequest: Promise<DashboardContext> | null = null

export function shouldLoadDashboardFromServer() {
  return getWorkspaceDataSource() === 'server' && hasServerSession()
}

/** 같은 세션(같은 사용자/데이터 소스)에서만 캐시를 재사용한다. */
function resolveDashboardCacheKey() {
  const source = shouldLoadDashboardFromServer() ? 'server' : 'mock'
  const identity = source === 'server' ? getServerSessionEmail() ?? '' : getCurrentSessionUserId() ?? ''

  return `${source}:${identity}`
}

/**
 * 마지막으로 불러온 대시보드 데이터.
 * 대시보드는 진입할 때마다 다시 조회하므로, 재진입 시 로딩 화면 없이 이 값을 먼저 그린 뒤 갱신한다.
 */
export function readCachedDashboardContext(): DashboardContext | null {
  if (!cachedDashboardContext || cachedDashboardContext.key !== resolveDashboardCacheKey()) {
    // 다른 사용자/데이터 소스의 데이터는 남겨두지 않는다.
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

function buildLocalDashboardContext(): DashboardContext {
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)

  if (!currentUser) {
    return { source: 'mock', viewer: null, workItems: [], recurringRules: [] }
  }

  const overview = getWorkspaceOverview(currentUser.userId, snapshot)
  // 목 데이터에는 서버의 owner_node_title 이 없으므로 스냅샷의 노드 이름으로 채운다.
  const nodeNamesById = new Map(snapshot.nodes.map((node) => [node.id, node.name]))

  return {
    source: 'mock',
    viewer: {
      userId: currentUser.userId,
      email: currentUser.email,
      name: currentUser.name,
      role: null,
      nodeId: overview.rootNode?.id ?? null,
      nodeTitle: overview.rootNode?.name ?? null,
      today: null,
      weekStartDate: null,
      weekEndDate: null,
    },
    // 목 데이터에는 서버 스코프 개념이 없으므로 접근 가능한 업무 전체를 사용한다.
    workItems: overview.visibleWorkItems.map((item) => ({
      ...item,
      nodeTitle: nodeNamesById.get(item.ownerNodeId) ?? null,
    })),
    recurringRules: readCachedRecurringRules().map((rule) => ({
      ...rule,
      nodeTitle: nodeNamesById.get(rule.ownerNodeId) ?? null,
    })),
  }
}

export async function loadDashboardContext(): Promise<DashboardContext> {
  // 같은 순간에 여러 번 호출되면(StrictMode 중복 마운트 등) 요청 하나를 공유한다.
  if (inFlightDashboardRequest) {
    return inFlightDashboardRequest
  }

  const cacheKey = resolveDashboardCacheKey()
  const request = (async () => {
    const context = shouldLoadDashboardFromServer()
      ? await fetchDashboardContext()
      : buildLocalDashboardContext()

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