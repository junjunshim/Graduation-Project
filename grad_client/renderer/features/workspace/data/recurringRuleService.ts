import type {
  CreateRecurringRuleRequest,
  RecurringRuleFileRecord,
  RecurringRuleRecord,
  UpdateRecurringRuleRequest,
} from '../model/recurringRuleTypes'
import { apiRequest } from './server/apiClient'
import { optionalRecurringNumber } from '../model/recurringRuleValues'

const LOCAL_STORAGE_RECURRING_KEY = 'grad_recurring_rules_cache'

type ServerResponse<T> = {
  status: 'success' | 'error'
  data?: T
  message?: string
  code?: string
}

function getLocalRecurringRules(nodeId?: number, includeDeleted: boolean = false): RecurringRuleRecord[] {
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

function saveLocalRecurringRules(rules: RecurringRuleRecord[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_RECURRING_KEY, JSON.stringify(rules))
  } catch {
    // ignore
  }
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
export async function fetchRecurringRules(nodeId: number, includeDeleted: boolean = false): Promise<RecurringRuleRecord[]> {
  try {
    const res = await apiRequest<ServerResponse<any[]>>(`/recurringRules?nodeId=${nodeId}${includeDeleted ? '&include_deleted=true' : ''}`)
    if (res.status === 'success' && Array.isArray(res.data)) {
      const parsed = res.data.map(snakeToCamelRule)
      // 로컬 캐시 동기화
      const currentAll = getLocalRecurringRules(undefined, true).filter((r) => r.ownerNodeId !== nodeId)
      saveLocalRecurringRules([...currentAll, ...parsed])
      return parsed
    }
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
      const updated = await fetchRecurringRules(req.ownerNodeId)
      const found = updated.find((r) => r.ruleId === createdRule.ruleId) ?? createdRule
      return { status: 'success', rule: found }
    }
    return { status: 'error', message: res.message || '정기 일정을 생성하지 못했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] createRecurringRule error, using local fallback:', error)
    // 로컬 폴백 (오프라인/테스트용)
    const newId = Date.now()
    const newRule: RecurringRuleRecord = {
      ruleId: newId,
      ownerNodeId: req.ownerNodeId,
      creatorUserId: 'me',
      assigneeUserId: req.assigneeUserId,
      title: req.title,
      description: req.description,
      category: req.category,
      frequency: req.frequency,
      intervalValue: req.intervalValue,
      byDay: req.byDay,
      byMonthDay: req.byMonthDay,
      bySetPos: req.bySetPos,
      startTime: req.startTime,
      durationMinutes: req.durationMinutes,
      repeatStartDate: req.repeatStartDate,
      repeatEndDate: req.repeatEndDate,
      maxOccurrences: req.maxOccurrences,
      excludeHolidays: req.excludeHolidays,
      holidayAction: req.holidayAction,
      autoCreateTask: req.autoCreateTask ?? false,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      checklists: (req.checklists ?? []).map((c, i) => ({
        checklistId: newId * 10 + i,
        ruleId: newId,
        content: c.content,
        sortOrder: c.sortOrder,
      })),
      files: (files ?? []).map((f, i) => ({
        fileId: newId * 100 + i,
        ruleId: newId,
        uploaderUserId: 'me',
        originalFileName: f.name,
        storedFileName: f.name,
        filePath: `/uploads/${f.name}`,
        fileSize: f.size,
        mimeType: f.type,
        createdAt: new Date().toISOString(),
      })),
    }
    const current = getLocalRecurringRules()
    saveLocalRecurringRules([newRule, ...current])
    return { status: 'success', rule: newRule }
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

      const current = getLocalRecurringRules()
      saveLocalRecurringRules(current.map((r) => (r.ruleId === req.ruleId ? updated : r)))
      return { status: 'success', rule: updated }
    }
    return { status: 'error', message: res.message || '정기 일정을 수정하지 못했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] updateRecurringRule error, using local fallback:', error)
    const current = getLocalRecurringRules()
    const target = current.find((r) => r.ruleId === req.ruleId)
    if (target) {
      const updated: RecurringRuleRecord = {
        ...target,
        ...(req.title !== undefined ? { title: req.title } : {}),
        ...(req.description !== undefined ? { description: req.description } : {}),
        ...(req.category !== undefined ? { category: req.category } : {}),
        ...(req.assigneeUserId !== undefined ? { assigneeUserId: req.assigneeUserId } : {}),
        ...(req.frequency !== undefined ? { frequency: req.frequency } : {}),
        ...(req.intervalValue !== undefined ? { intervalValue: req.intervalValue } : {}),
        ...(req.byDay !== undefined ? { byDay: req.byDay } : {}),
        ...(req.byMonthDay !== undefined ? { byMonthDay: req.byMonthDay } : {}),
        ...(req.bySetPos !== undefined ? { bySetPos: req.bySetPos } : {}),
        ...(req.startTime !== undefined ? { startTime: req.startTime } : {}),
        ...(req.durationMinutes !== undefined ? { durationMinutes: req.durationMinutes } : {}),
        ...(req.repeatStartDate !== undefined ? { repeatStartDate: req.repeatStartDate } : {}),
        ...(req.repeatEndDate !== undefined ? { repeatEndDate: req.repeatEndDate } : {}),
        ...(req.maxOccurrences !== undefined ? { maxOccurrences: req.maxOccurrences } : {}),
        ...(req.excludeHolidays !== undefined ? { excludeHolidays: req.excludeHolidays } : {}),
        ...(req.holidayAction !== undefined ? { holidayAction: req.holidayAction } : {}),
        ...(req.autoCreateTask !== undefined ? { autoCreateTask: req.autoCreateTask } : {}),
        ...(req.isActive !== undefined ? { isActive: req.isActive } : {}),
        ...(req.checklists !== undefined
          ? {
              checklists: req.checklists.map((c, i) => ({
                checklistId: req.ruleId * 10 + i,
                ruleId: req.ruleId,
                content: c.content,
                sortOrder: c.sortOrder,
              })),
            }
          : {}),
        updatedAt: new Date().toISOString(),
      }
      saveLocalRecurringRules(current.map((r) => (r.ruleId === req.ruleId ? updated : r)))
      return { status: 'success', rule: updated }
    }
    return { status: 'error', message: '일정을 찾을 수 없습니다.' }
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
      saveLocalRecurringRules(
        current.map((r) => (r.ruleId === ruleId ? { ...r, isDeleted: true } : r)),
      )
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '삭제에 실패했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] deleteRecurringRule local fallback:', error)
    const current = getLocalRecurringRules(undefined, true)
    saveLocalRecurringRules(
      current.map((r) => (r.ruleId === ruleId ? { ...r, isDeleted: true } : r)),
    )
    return { status: 'success' }
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
      return { status: 'success', file: uploadedFile }
    }
    return { status: 'error', message: res.message || '파일 업로드에 실패했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] uploadRecurringRuleFile fallback:', error)
    const mockFile: RecurringRuleFileRecord = {
      fileId: Date.now(),
      ruleId,
      uploaderUserId: 'me',
      originalFileName: file.name,
      storedFileName: file.name,
      filePath: `/uploads/${file.name}`,
      fileSize: file.size,
      mimeType: file.type,
      createdAt: new Date().toISOString(),
    }
    return { status: 'success', file: mockFile }
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
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '파일 삭제에 실패했습니다.' }
  } catch (error) {
    return { status: 'success' }
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
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '정기 일정 복구에 실패했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] restoreRecurringRule error:', error)
    return { status: 'success' }
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
      return { status: 'success' }
    }
    return { status: 'error', message: res.message || '정기 일정 파일 복구에 실패했습니다.' }
  } catch (error) {
    console.warn('[recurringRuleService] restoreRecurringRuleFile error:', error)
    return { status: 'success' }
  }
}

/**
 * 정기 일정 파일 텍스트 내용 조회 (FileContentViewerModal 연동용)
 */
export async function fetchRecurringRuleFileContent(
  fileId: number,
  fallbackSampleText?: string,
): Promise<{ content: string; fromCache: boolean; lastModified?: string }> {
  const cacheKey = `grad-recurring-file-cache-${fileId}`
  let cached: { content: string; lastModified?: string } | null = null
  try {
    const raw = localStorage.getItem(cacheKey)
    if (raw) cached = JSON.parse(raw)
  } catch {
    // ignore
  }

  const { isServerDataSource } = await import('./workspaceMode')
  if (!isServerDataSource()) {
    if (cached) {
      return { content: cached.content, fromCache: true, lastModified: cached.lastModified }
    }
    const sample = fallbackSampleText || '# 정기 일정 서식 파일\n\n해당 파일은 데모 파일입니다.'
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ content: sample, lastModified: new Date().toISOString() }))
    } catch {
      // ignore
    }
    return { content: sample, fromCache: false }
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
