import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { readCachedRecurringRules } from '../../workspace/data/recurringRuleService'
import { apiRequest, hasServerSession } from '../../workspace/data/server/apiClient'
import {
  isServerStatusResponse,
  parseServerContextItems,
  type ServerContextResponse,
} from '../../workspace/data/server/apiTypes'
import { getWorkspaceDataSource } from '../../workspace/data/server/workspaceMode'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { adaptDashboardContext } from '../model/dashboardAdapter'
import type { DashboardContext } from '../model/dashboardTypes'

const DASHBOARD_CONTEXT_PATH = '/context/dashboard'

export function shouldLoadDashboardFromServer() {
  return getWorkspaceDataSource() === 'server' && hasServerSession()
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
    workItems: overview.visibleWorkItems,
    recurringRules: readCachedRecurringRules(),
  }
}

export async function loadDashboardContext(): Promise<DashboardContext> {
  if (shouldLoadDashboardFromServer()) {
    return fetchDashboardContext()
  }

  return buildLocalDashboardContext()
}