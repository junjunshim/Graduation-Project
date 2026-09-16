import type { ServerContextItem } from '../../workspace/data/server/apiTypes'
import { normalizeWorkItemStatus } from '../../workspace/data/server/contextAdapter'
import type {
  HolidayAction,
  RecurringCategory,
  RecurringFrequency,
  RecurringRuleRecord,
} from '../../workspace/model/recurringRuleTypes'
import type { WorkItemRecord } from '../../workspace/model/types'
import type { DashboardContext, DashboardViewer } from './dashboardTypes'

/** /context/dashboard 응답에만 등장하는 필드. 공용 ServerContextItem은 그대로 둔다. */
type DashboardContextItem = ServerContextItem & {
  node_title?: string
  today?: string
  week_start_date?: string
  week_end_date?: string
  rule_id?: number | string
  creator_user_id?: string
  assignee_user_id?: string | null
  frequency?: string
  interval_value?: number | string
  by_day?: string | null
  by_month_day?: number | string | null
  by_set_pos?: number | string | null
  start_time?: string | null
  duration_minutes?: number | string | null
  repeat_start_date?: string
  repeat_end_date?: string | null
  max_occurrences?: number | string | null
  exclude_holidays?: boolean
  holiday_action?: string
  auto_create_task?: boolean
  is_active?: boolean
}

function readItemType(value: unknown) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function readText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const text = String(value).trim()
  return text ? text : null
}

function readNumber(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readOptionalNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readOptionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function readBoolean(value: unknown, fallback: boolean) {
  if (value === null || value === undefined) {
    return fallback
  }

  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === 't' || normalized === '1') return true
    if (normalized === 'false' || normalized === 'f' || normalized === '0') return false
  }

  return fallback
}

function parseViewer(item: DashboardContextItem): DashboardViewer | null {
  const userId = readText(item.user_id)

  if (!userId) {
    return null
  }

  return {
    userId,
    email: readText(item.email) ?? '',
    name: readText(item.name) ?? userId,
    role: readText(item.role),
    nodeId: readOptionalPositiveNumber(item.node_id),
    nodeTitle: readText(item.node_title),
    today: readText(item.today),
    weekStartDate: readText(item.week_start_date),
    weekEndDate: readText(item.week_end_date),
  }
}

/**
 * 대시보드 응답에는 NODE/USER 항목이 없어서 워크스페이스 어댑터(normalizeServerContext)를
 * 그대로 쓰면 소유 노드/사용자 검증에서 업무가 전부 탈락한다. 여기서는 업무 항목만 직접 매핑한다.
 */
function parseWorkItem(item: DashboardContextItem): WorkItemRecord | null {
  const workItemId = readText(item.id)
  const ownerNodeId = readNumber(item.owner_node_id, 0)

  if (!workItemId || ownerNodeId <= 0) {
    return null
  }

  const displayId = readOptionalPositiveNumber(item.display_id)
  const startDate = readText(item.start_date)
  const dueDate = readText(item.due_date)
  const parentWorkItemId = readText(item.parent_work_item_id)
  const updatedAt = readText(item.updated_at)
  const rawPriority = readNumber(item.priority, 3)
  const rawWeight = readNumber(item.weight, 1)
  const rawProgress = readNumber(item.progress, 0)

  return {
    workItemId,
    ...(displayId ? { displayId } : {}),
    ownerNodeId,
    ownerUserId: readText(item.owner_user_id) ?? '',
    title: readText(item.title) ?? workItemId,
    description: readText(item.description) ?? '',
    ...(readText(item.category) ? { category: readText(item.category) as string } : {}),
    status: normalizeWorkItemStatus(item.status),
    priority: rawPriority >= 1 && rawPriority <= 5 ? rawPriority : 3,
    hidden: readBoolean(item.hidden, false),
    weight: rawWeight >= 0 ? rawWeight : 1,
    progress: Math.min(100, Math.max(0, rawProgress)),
    commentCount: readNumber(item.comment_count, 0),
    isDeleted: readBoolean(item.is_deleted, false),
    ...(startDate ? { startDate } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(parentWorkItemId ? { parentWorkItemId } : {}),
    createdAt: readText(item.created_at) ?? updatedAt ?? new Date().toISOString(),
    ...(updatedAt ? { updatedAt } : {}),
  }
}

function parseRecurringRule(item: DashboardContextItem): RecurringRuleRecord | null {
  const ruleId = readOptionalPositiveNumber(item.rule_id)

  if (!ruleId) {
    return null
  }

  return {
    ruleId,
    ownerNodeId: readNumber(item.owner_node_id, 0),
    creatorUserId: readText(item.creator_user_id) ?? '',
    assigneeUserId: readText(item.assignee_user_id),
    title: readText(item.title) ?? '',
    description: readText(item.description),
    category: (readText(item.category) ?? 'ROUTINE') as RecurringCategory,
    frequency: (readText(item.frequency) ?? 'DAILY') as RecurringFrequency,
    intervalValue: Math.max(1, readNumber(item.interval_value, 1)),
    byDay: readText(item.by_day),
    byMonthDay: readOptionalNumber(item.by_month_day),
    bySetPos: readOptionalNumber(item.by_set_pos),
    startTime: readText(item.start_time),
    durationMinutes: readOptionalNumber(item.duration_minutes),
    repeatStartDate: readText(item.repeat_start_date) ?? '',
    repeatEndDate: readText(item.repeat_end_date),
    maxOccurrences: readOptionalNumber(item.max_occurrences),
    excludeHolidays: readBoolean(item.exclude_holidays, true),
    holidayAction: (readText(item.holiday_action) ?? 'SKIP') as HolidayAction,
    autoCreateTask: readBoolean(item.auto_create_task, false),
    isActive: readBoolean(item.is_active, true),
    isDeleted: readBoolean(item.is_deleted, false),
    createdAt: readText(item.created_at) ?? new Date().toISOString(),
    updatedAt: readText(item.updated_at) ?? undefined,
  }
}

export function adaptDashboardContext(items: ServerContextItem[]): DashboardContext {
  const dashboardItems = items as DashboardContextItem[]
  const viewerItem = dashboardItems.find((item) => readItemType(item.type) === 'DASHBOARD_VIEWER')

  return {
    source: 'server',
    viewer: viewerItem ? parseViewer(viewerItem) : null,
    workItems: dashboardItems
      .filter((item) => readItemType(item.type) === 'WORK_ITEM')
      .map(parseWorkItem)
      .filter((item): item is WorkItemRecord => item !== null),
    recurringRules: dashboardItems
      .filter((item) => readItemType(item.type) === 'RECURRING_RULE')
      .map(parseRecurringRule)
      .filter((rule): rule is RecurringRuleRecord => rule !== null),
  }
}