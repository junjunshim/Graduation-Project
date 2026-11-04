import type {
  CreateRecurringRuleRequest,
  RecurringRuleFileRecord,
  RecurringRuleRecord,
  UpdateRecurringRuleRequest,
} from '../model/recurringRuleTypes'
import { apiRequest } from './server/apiClient'
import { optionalRecurringNumber } from '../model/recurringRuleValues'
import { waitForDownloadCompletion } from './downloadCompletion'
import { notifyRecurringCacheUpdated } from './workspaceCacheEvents'
import { queryWithCache } from './queryCache.js'
import { refreshNodesAfterCommittedMutation } from './server/serverWorkspace'

const LOCAL_STORAGE_RECURRING_KEY = 'grad_recurring_rules_cache'
const LOCAL_STORAGE_LOADED_NODES_KEY = 'grad_recurring_rules_loaded_nodes'
const RECURRING_RULES_CACHE_TTL_MS = 60_000

type ServerResponse<T> = {
  status: 'success' | 'error'
  data?: T
  message?: string
  code?: string
}

/**
 * 특정 노드의 정기 일정이 최소 1회 서버로부터 동기화되었는지 확인합니다.
 * (일정이 0개인 노드에서도 불필요한 로딩 상태 깜빡임을 방지)
 */
export function hasLoadedRecurringRulesForNode(nodeId: number): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) return false
  try {
    const raw = window.sessionStorage.getItem(LOCAL_STORAGE_LOADED_NODES_KEY)
    if (!raw) return false
    const set = JSON.parse(raw) as number[]
    return Array.isArray(set) && set.includes(nodeId)
  } catch {
    return false
  }
}

export function markRecurringRulesLoadedForNode(nodeId: number) {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    const raw = window.sessionStorage.getItem(LOCAL_STORAGE_LOADED_NODES_KEY)
    const set = raw ? (JSON.parse(raw) as number[]) : []
    if (!set.includes(nodeId)) {
      set.push(nodeId)
      window.sessionStorage.setItem(LOCAL_STORAGE_LOADED_NODES_KEY, JSON.stringify(set))
    }
  } catch {
    // ignore
  }
}

/**
 * 서버 요청이 실패했을 때 보여줄 메시지.
 * 서버가 내려준 사유(예: '권한이 부족합니다.')를 우선 사용한다.
 */
function toMutationErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function getLocalRecurringRules(nodeId?: number, includeDeleted: boolean = false): RecurringRuleRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_RECURRING_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as RecurringRuleRecord[]
    if (nodeId !== undefined) {
      return list.filter((r) => r.ownerNodeId === nodeId && (includeDeleted || !r.isDeleted))
    }
    return includeDeleted ? list : list.filter((r) => !r.isDeleted)
  } catch {
    return []
  }
}

/** 서버 조회 없이 캐시된 정기 일정만 필요한 화면(대시보드 등)에서 사용 */
export function readCachedRecurringRules(): RecurringRuleRecord[] {
  return getLocalRecurringRules()
}

function saveLocalRecurringRules(rules: RecurringRuleRecord[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_RECURRING_KEY, JSON.stringify(rules))
  } catch {
    // ignore
  }
}

function findRecurringRuleByFileId(fileId: number) {
  return getLocalRecurringRules(undefined, true).find((rule) =>
    (rule.files ?? []).some((file) => file.fileId === fileId),
  )
}

function saveRecurringRuleFileState(ruleId: number, fileId: number, isDeleted: boolean) {
  const current = getLocalRecurringRules(undefined, true)
  saveLocalRecurringRules(
    current.map((rule) => {
      if (rule.ruleId !== ruleId) return rule

      return {
        ...rule,
        files: (rule.files ?? []).map((file) =>
          file.fileId === fileId ? { ...file, isDeleted } : file,
        ),
      }
    }),
  )
}

function snakeToCamelRule(item: any): RecurringRuleRecord {
  return {
    ruleId: Number(item.rule_id ?? item.ruleId),
    ownerNodeId: Number(item.owner_node_id ?? item.ownerNodeId),
    creatorUserId: String(item.creator_user_id ?? item.creatorUserId ?? ''),
    assigneeUserId: item.assignee_user_id ?? item.assigneeUserId ?? null,
    title: String(item.title ?? ''),
    description: item.description ?? null,
    category: item.category ?? 'ROUTINE',
    frequency: item.frequency ?? 'DAILY',
    intervalValue: Number(item.interval_value ?? item.intervalValue ?? 1),
    byDay: item.by_day ?? item.byDay ?? null,
    byMonthDay: optionalRecurringNumber(item.by_month_day ?? item.byMonthDay),
    bySetPos: optionalRecurringNumber(item.by_set_pos ?? item.bySetPos),
    startTime: item.start_time ?? item.startTime ?? null,
    durationMinutes: item.duration_minutes !== undefined ? Number(item.duration_minutes) : (item.durationMinutes ?? 60),
    repeatStartDate: item.repeat_start_date ?? item.repeatStartDate ?? '',
    repeatEndDate: item.repeat_end_date ?? item.repeatEndDate ?? null,
    maxOccurrences: optionalRecurringNumber(item.max_occurrences ?? item.maxOccurrences),
    excludeHolidays: Boolean(item.exclude_holidays ?? item.excludeHolidays ?? true),
    holidayAction: item.holiday_action ?? item.holidayAction ?? 'SKIP',
    autoCreateTask: Boolean(item.auto_create_task ?? item.autoCreateTask ?? false),
    isActive: Boolean(item.is_active ?? item.isActive ?? true),
    isDeleted: Boolean(item.is_deleted ?? item.isDeleted ?? false),
    createdAt: item.created_at ?? item.createdAt ?? new Date().toISOString(),
    updatedAt: item.updated_at ?? item.updatedAt ?? new Date().toISOString(),
    checklists: (item.checklists ?? []).map((c: any) => ({
      checklistId: Number(c.checklist_id ?? c.checklistId),
      ruleId: Number(c.rule_id ?? c.ruleId),
      content: String(c.content ?? ''),
      sortOrder: Number(c.sort_order ?? c.sortOrder ?? 0),
      createdAt: c.created_at ?? c.createdAt,
    })),
    files: (item.files ?? []).map((f: any) => ({
      fileId: Number(f.file_id ?? f.fileId),
      ruleId: Number(f.rule_id ?? f.ruleId),
      uploaderUserId: String(f.uploader_user_id ?? f.uploaderUserId ?? ''),
      originalFileName: String(f.original_file_name ?? f.originalFileName ?? ''),
      storedFileName: String(f.stored_file_name ?? f.storedFileName ?? ''),
      filePath: String(f.file_path ?? f.filePath ?? ''),
      fileSize: Number(f.file_size ?? f.fileSize ?? 0),
      mimeType: f.mime_type ?? f.mimeType ?? null,
      isDeleted: Boolean(f.is_deleted ?? f.isDeleted ?? false),
      createdAt: f.created_at ?? f.createdAt ?? new Date().toISOString(),
      updatedAt: f.updated_at ?? f.updatedAt,
    })),
  }
}

/**
 * 노드별 정기 일정 목록 조회
 */
export async function fetchRecurringRules(
  nodeId: number,
  includeDeleted: boolean = false,
  options?: { forceRefresh?: boolean },
): Promise<RecurringRuleRecord[]> {
  try {
    return await queryWithCache(
      `recurring:${nodeId}:${includeDeleted ? 'all' : 'active'}`,
      async () => {
        const res = await apiRequest<ServerResponse<any[]>>(`/recurringRules?nodeId=${nodeId}${includeDeleted ? '&include_deleted=true' : ''}`)
        if (res.status !== 'success' || !Array.isArray(res.data)) {
          throw new Error(res.message || '정기 일정 목록 응답 형식이 올바르지 않습니다.')
        }

        const parsed = res.data.map(snakeToCamelRule)
        // 로컬 캐시 동기화
        const currentAll = getLocalRecurringRules(undefined, true).filter((r) => r.ownerNodeId !== nodeId)
        saveLocalRecurringRules([...currentAll, ...parsed])
        markRecurringRulesLoadedForNode(nodeId)
        return parsed
      },
      { ttlMs: RECURRING_RULES_CACHE_TTL_MS, forceRefresh: options?.forceRefresh },
    )
  } catch (error) {
    console.warn('[recurringRuleService] fetchRecurringRules fallback to local cache:', error)
  }
  return getLocalRecurringRules(nodeId, includeDeleted)
}

/**
 * 단일 정기 일정 조회
 */
export async function fetchRecurringRuleDetail(ruleId: number): Promise<RecurringRuleRecord | null> {
  try {
    const res = await apiRequest<ServerResponse<any>>(`/recurringRules/${ruleId}`)
    if (res.status === 'success' && res.data) {
      return snakeToCamelRule(res.data)
    }
  } catch (error) {
    console.warn('[recurringRuleService] fetchRecurringRuleDetail fallback to local cache:', error)
  }
  const all = getLocalRecurringRules(undefined, true)
  return all.find((r) => r.ruleId === ruleId) ?? null
}

/**
 * 정기 일정 신규 생성
 */
export async function createRecurringRule(
  req: CreateRecurringRuleRequest,
  files?: File[],
): Promise<{ status: 'success' | 'error'; rule?: RecurringRuleRecord; message?: string }> {
  try {
    const payload = {
      owner_node_id: req.ownerNodeId,
      title: req.title,
      description: req.description ?? '',
      category: req.category,
      assignee_user_id: req.assigneeUserId,
      frequency: req.frequency,
      interval_value: req.intervalValue,
      by_day: req.byDay,
      by_month_day: req.byMonthDay,
      by_set_pos: req.bySetPos,
      start_time: req.startTime,
      duration_minutes: req.durationMinutes,
      repeat_start_date: req.repeatStartDate,
      repeat_end_date: req.repeatEndDate,
      max_occurrences: req.maxOccurrences,
      exclude_holidays: req.excludeHolidays,
      holiday_action: req.holidayAction,
      auto_create_task: req.autoCreateTask ?? false,
      checklists: req.checklists ?? [],
    }

    const res = await apiRequest<ServerResponse<any>>('/recurringRules', {
      method: 'POST',
      body: payload,
    })

    if (res.status === 'success' && res.data) {
      const createdRule = snakeToCamelRule(res.data)

      // 첨부파일이 있는 경우 추가 업로드
      if (files && files.length > 0) {
        for (const file of files) {
          await uploadRecurringRuleFile(createdRule.ruleId, file)
        }
      }

      // 로컬 캐시 갱신
      const updated = await fetchRecurringRules(req.ownerNodeId, false, { forceRefresh: true })
      const found = updated.find((r) => r.ruleId === createdRule.ruleId) ?? createdRule
      notifyRecurringCacheUpdated(req.ownerNodeId)
      await refreshNodesAfterCommittedMutation([req.ownerNodeId])
      return { status: 'success', rule: found }
    }
    return { status: 'error', message: res.message || '정기 일정을 생성하지 못했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '정기 일정을 생성하지 못했습니다.') }
  }
}

/**
 * 정기 일정 수정
 */
export async function updateRecurringRule(
  req: UpdateRecurringRuleRequest,
  files?: File[],
): Promise<{ status: 'success' | 'error'; rule?: RecurringRuleRecord; message?: string }> {
  try {
    const payload = {
      title: req.title,
      description: req.description,
      category: req.category,
      assignee_user_id: req.assigneeUserId,
      frequency: req.frequency,
      interval_value: req.intervalValue,
      by_day: req.byDay,
      by_month_day: req.byMonthDay,
      by_set_pos: req.bySetPos,
      start_time: req.startTime,
      duration_minutes: req.durationMinutes,
      repeat_start_date: req.repeatStartDate,
      repeat_end_date: req.repeatEndDate,
      max_occurrences: req.maxOccurrences,
      exclude_holidays: req.excludeHolidays,
      holiday_action: req.holidayAction,
      auto_create_task: req.autoCreateTask,
      is_active: req.isActive,
      checklists: req.checklists,
    }

    const res = await apiRequest<ServerResponse<any>>(`/recurringRules/${req.ruleId}`, {
      method: 'PUT',
      body: payload,
    })

    if (res.status === 'success' && res.data) {
      let updated = snakeToCamelRule(res.data)

      // 신규 추가된 첨부파일이 있는 경우 업로드
      if (files && files.length > 0) {
        for (const file of files) {
          await uploadRecurringRuleFile(updated.ruleId, file)
        }
        // 업로드 후 최신 상세 정보 다시 조회
        const detailed = await fetchRecurringRuleDetail(updated.ruleId)
        if (detailed) {
          updated = detailed
        }
      }

      const current = getLocalRecurringRules(undefined, true)
      saveLocalRecurringRules(current.map((r) => (r.ruleId === req.ruleId ? updated : r)))
      notifyRecurringCacheUpdated(updated.ownerNodeId)
      await refreshNodesAfterCommittedMutation([updated.ownerNodeId])
      return { status: 'success', rule: updated }
    }
    return { status: 'error', message: res.message || '정기 일정을 수정하지 못했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '정기 일정을 수정하지 못했습니다.') }
  }
}

/**
 * 정기 일정 삭제 (소프트 딜리트)
 */
export async function deleteRecurringRule(ruleId: number): Promise<{ status: 'success' | 'error'; message?: string }> {
  try {
    const res = await apiRequest<ServerResponse<unknown>>(`/recurringRules/${ruleId}`, {
      method: 'DELETE',
    })
    if (res.status === 'success') {
      const current = getLocalRecurringRules(undefined, true)
      const target = current.find((r) => r.ruleId === ruleId)
      saveLocalRecurringRules(
        current.map((r) => (r.ruleId === ruleId ? { ...r, isDeleted: true } : r)),
      )
      notifyRecurringCacheUpdated(target?.ownerNodeId)
      await refreshNodesAfterCommittedMutation([target?.ownerNodeId])
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '삭제에 실패했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '삭제에 실패했습니다.') }
  }
}

/**
 * 정기 일정 파일 다운로드
 */
export async function downloadRecurringRuleFile(fileId: number, fileName: string): Promise<void> {
  const blob = await apiRequest<Blob>(`/recurringRules/files/${fileId}/download`, {
    responseType: 'blob',
    timeoutMs: 120_000,
  })
  // 다운로드 시작 전에 완료 추적을 등록해 실제 저장 완료 시점까지 기다린다.
  const completion = waitForDownloadCompletion(fileName)

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.hidden = true
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  await completion
}

/**
 * 정기 일정 템플릿 파일 업로드
 */
export async function uploadRecurringRuleFile(
  ruleId: number,
  file: File,
): Promise<{ status: 'success' | 'error'; file?: RecurringRuleFileRecord; message?: string }> {
  try {
    const formData = new FormData()
    formData.append('file', file)

    const res = await apiRequest<ServerResponse<any>>(`/recurringRules/${ruleId}/files`, {
      method: 'POST',
      formData,
    })

    if (res.status === 'success' && res.data) {
      const uploadedFile: RecurringRuleFileRecord = {
        fileId: Number(res.data.file_id ?? res.data.fileId),
        ruleId: Number(res.data.rule_id ?? res.data.ruleId),
        uploaderUserId: String(res.data.uploader_user_id ?? res.data.uploaderUserId ?? ''),
        originalFileName: String(res.data.original_file_name ?? res.data.originalFileName ?? file.name),
        storedFileName: String(res.data.stored_file_name ?? res.data.storedFileName ?? file.name),
        filePath: String(res.data.file_path ?? res.data.filePath ?? ''),
        fileSize: Number(res.data.file_size ?? res.data.fileSize ?? file.size),
        mimeType: res.data.mime_type ?? res.data.mimeType ?? file.type,
        createdAt: res.data.created_at ?? res.data.createdAt ?? new Date().toISOString(),
      }

      // 새로 등록된 파일 캐시 무효화
      try {
        localStorage.removeItem(`grad-recurring-file-cache-${uploadedFile.fileId}`)
      } catch {
        // ignore
      }

      const ownerNodeId = getLocalRecurringRules(undefined, true).find(
        (rule) => rule.ruleId === ruleId,
      )?.ownerNodeId
      saveLocalRecurringRules(
        getLocalRecurringRules(undefined, true).map((rule) =>
          rule.ruleId === ruleId
            ? {
                ...rule,
                files: [
                  ...(rule.files ?? []).filter((file) => file.fileId !== uploadedFile.fileId),
                  uploadedFile,
                ],
              }
            : rule,
        ),
      )
      notifyRecurringCacheUpdated(ownerNodeId)

      return { status: 'success', file: uploadedFile }
    }
    return { status: 'error', message: res.message || '파일 업로드에 실패했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '파일 업로드에 실패했습니다.') }
  }
}

/**
 * 정기 일정 파일 삭제
 */
export async function deleteRecurringRuleFile(
  fileId: number,
): Promise<{ status: 'success' | 'error'; message?: string }> {
  try {
    const res = await apiRequest<ServerResponse<unknown>>(`/recurringRules/files/${fileId}`, {
      method: 'DELETE',
    })
    if (res.status === 'success') {
      const rule = findRecurringRuleByFileId(fileId)
      if (rule) {
        saveRecurringRuleFileState(rule.ruleId, fileId, true)
      }
      notifyRecurringCacheUpdated(rule?.ownerNodeId)
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '파일 삭제에 실패했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '파일 삭제에 실패했습니다.') }
  }
}

/**
 * 정기 일정 복구
 */
export async function restoreRecurringRule(
  ruleId: number,
  cascade: boolean = false,
): Promise<{ status: 'success' | 'error'; message?: string }> {
  try {
    const res = await apiRequest<ServerResponse<unknown>>(`/recurringRules/${ruleId}/restore?cascade=${cascade}`, {
      method: 'PATCH',
    })
    if (res.status === 'success') {
      const current = getLocalRecurringRules(undefined, true)
      const target = current.find((r) => r.ruleId === ruleId)
      saveLocalRecurringRules(
        current.map((r) => (r.ruleId === ruleId ? { ...r, isDeleted: false } : r)),
      )
      notifyRecurringCacheUpdated(target?.ownerNodeId)
      await refreshNodesAfterCommittedMutation([target?.ownerNodeId])
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '정기 일정 복구에 실패했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '정기 일정 복구에 실패했습니다.') }
  }
}

/**
 * 정기 일정 파일 복구
 */
export async function restoreRecurringRuleFile(
  fileId: number,
): Promise<{ status: 'success' | 'error'; message?: string }> {
  try {
    const res = await apiRequest<ServerResponse<unknown>>(`/recurringRules/files/${fileId}/restore`, {
      method: 'PATCH',
    })
    if (res.status === 'success') {
      const rule = findRecurringRuleByFileId(fileId)
      if (rule) {
        saveRecurringRuleFileState(rule.ruleId, fileId, false)
      }
      notifyRecurringCacheUpdated(rule?.ownerNodeId)
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '정기 일정 파일 복구에 실패했습니다.' }
  } catch (error) {
    return { status: 'error', message: toMutationErrorMessage(error, '정기 일정 파일 복구에 실패했습니다.') }
  }
}

/**
 * 정기 일정 파일 텍스트 내용 조회 (FileContentViewerModal 연동용)
 */
export async function fetchRecurringRuleFileContent(
  fileId: number,
): Promise<{ content: string; fromCache: boolean; lastModified?: string }> {
  const cacheKey = `grad-recurring-file-cache-${fileId}`
  let cached: { content: string; lastModified?: string } | null = null
  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) cached = JSON.parse(raw)
  } catch {
    // ignore
  }

  const { getServerAccessToken } = await import('./server/apiClient')
  const { getWorkspaceApiBaseUrl } = await import('./server/workspaceMode.js')
  const token = getServerAccessToken()
  const baseUrl = getWorkspaceApiBaseUrl()
  const url = `${baseUrl}/recurringRules/files/${fileId}/download`

  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  if (cached?.lastModified) {
    headers['If-Modified-Since'] = cached.lastModified
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    if (response.status === 304 && cached) {
      return {
        content: cached.content,
        fromCache: true,
        lastModified: cached.lastModified,
      }
    }

    if (!response.ok) {
      throw new Error(`파일 다운로드 실패 (HTTP ${response.status})`)
    }

    const textContent = await response.text()
    const serverLastModified = response.headers.get('Last-Modified') || new Date().toISOString()

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ content: textContent, lastModified: serverLastModified }))
    } catch {
      // ignore
    }

    return {
      content: textContent,
      fromCache: false,
      lastModified: serverLastModified,
    }
  } catch (error) {
    if (cached) {
      console.warn('[recurringRuleService] 네트워크 요청 실패, 캐시 반환:', error)
      return { content: cached.content, fromCache: true, lastModified: cached.lastModified }
    }
    throw error
  }
}
