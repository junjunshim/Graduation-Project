import { apiRequest, getServerAccessToken } from './server/apiClient'
import { isServerStatusResponse } from './server/apiTypes'
import { getWorkspaceApiBaseUrl } from './server/workspaceMode.js'
import { readWorkspaceDb, writeServerWorkspaceDb } from './localStore'
import { waitForDownloadCompletion } from './downloadCompletion'
import {
  deleteCachedFileContent,
  getCachedFileContent,
  setCachedFileContent,
} from './fileContentCache'

export type { CachedFileItem } from './fileContentCache'

const FILE_CACHE_PREFIX = 'grad-file-cache-'
let legacyFileCacheCleanupScheduled = false

function cleanupLegacyFileCacheStorage() {
  if (
    legacyFileCacheCleanupScheduled ||
    typeof window === 'undefined' ||
    typeof window.localStorage === 'undefined'
  ) {
    return
  }

  legacyFileCacheCleanupScheduled = true
  globalThis.setTimeout(() => {
    try {
      const legacyKeys: string[] = []
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index)
        if (key?.startsWith(FILE_CACHE_PREFIX)) {
          legacyKeys.push(key)
        }
      }
      legacyKeys.forEach((key) => window.localStorage.removeItem(key))
    } catch {
      // A storage failure must not affect file viewing.
    }
  }, 0)
}

export async function downloadWorkItemFile(fileId: number, fileName: string): Promise<void> {
  const blob = await apiRequest<Blob>(`/workItems/files/download?file_id=${fileId}`, {
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

export async function uploadWorkItemFile(workItemId: string, file: File): Promise<void> {
  if (!workItemId.trim()) {
    throw new Error('파일을 등록할 업무를 선택해 주세요.')
  }
  const formData = new FormData()
  formData.append('work_item_id', workItemId)
  formData.append('file', file)
  const response = await apiRequest<unknown>('/workItems/files/upload', {
    method: 'POST',
    formData,
    timeoutMs: 120_000,
  })
  if (!isServerStatusResponse(response)) {
    throw new Error('파일 등록 응답 형식이 올바르지 않습니다.')
  }
  if (response.status === 'error') {
    throw new Error(response.message || '파일을 등록하지 못했습니다.')
  }

  // 새로 등록된 파일의 ID가 반환된 경우, 로컬에 남아있을 수 있는 이전 캐시를 즉시 무효화
  try {
    const rawData = (response as { data?: Array<{ file_id?: number }> }).data
    if (Array.isArray(rawData) && rawData.length > 0 && typeof rawData[0]?.file_id === 'number') {
      const newFileId = rawData[0].file_id
      await deleteCachedFileContent(newFileId)
    }
  } catch (err) {
    console.warn('[fileService] 업로드 후 캐시 무효화 실패:', err)
  }
}

export async function deleteWorkItemFile(fileId: number): Promise<void> {
  const response = await apiRequest<unknown>('/workItems/files', {
    method: 'DELETE',
    body: { file_id: fileId },
  })

  if (!isServerStatusResponse(response)) {
    throw new Error('파일 삭제 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message || '파일을 삭제하지 못했습니다.')
  }

  // 삭제 성공 시 로컬 캐시(readWorkspaceDb)에 즉시 isDeleted = true 반영
  try {
    const currentDb = readWorkspaceDb()
    if (currentDb.files) {
      const fileIndex = currentDb.files.findIndex((f) => f.id === fileId)
      if (fileIndex >= 0) {
        currentDb.files[fileIndex].isDeleted = true
        writeServerWorkspaceDb(currentDb)
      }
    }
  } catch (err) {
    console.warn('[fileService] 로컬 캐시 삭제 반영 실패:', err)
  }
}

export async function restoreWorkItemFile(fileId: number): Promise<void> {
  const response = await apiRequest<unknown>('/workItems/files/restore', {
    method: 'PATCH',
    body: { file_id: fileId },
  })

  if (!isServerStatusResponse(response)) {
    throw new Error('파일 복구 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message || '파일을 복구하지 못했습니다.')
  }

  // 복구 성공 시 로컬 캐시(readWorkspaceDb)에 즉시 isDeleted = false 반영
  try {
    const currentDb = readWorkspaceDb()
    if (currentDb.files) {
      const fileIndex = currentDb.files.findIndex((f) => f.id === fileId)
      if (fileIndex >= 0) {
        currentDb.files[fileIndex].isDeleted = false
        writeServerWorkspaceDb(currentDb)
      }
    }
  } catch (err) {
    console.warn('[fileService] 로컬 캐시 복구 반영 실패:', err)
  }
}

export type FetchFileContentResult = {
  content: string
  fromCache: boolean
  lastModified?: string
}

export type FetchFileContentOptions = {
  expectedFileName?: string
  expectedUpdatedAt?: string
  bypassCache?: boolean
}


/**
 * 서버에서 파일 내용을 가져옵니다.
 * 이전에 다운로드한 기록이 있다면 If-Modified-Since 헤더를 전송하여
 * 변경되지 않았을 시 304 응답을 받고 로컬 캐시 내용을 즉시 반환합니다.
 */
export async function fetchWorkItemFileContent(
  fileId: number,
  options?: FetchFileContentOptions,
): Promise<FetchFileContentResult> {
  cleanupLegacyFileCacheStorage()
  const cached = await getCachedFileContent(fileId)

  // 캐시된 파일명 또는 예상 수정시각이 불일치하면 이전 파일 캐시로 간주하고 무효화
  const isCacheInvalid =
    options?.bypassCache ||
    (cached && options?.expectedFileName && cached.fileName !== `file_${fileId}` && cached.fileName !== options.expectedFileName)

  if (isCacheInvalid && cached) {
    await deleteCachedFileContent(fileId)
  }

  const validCache = isCacheInvalid ? null : cached
  const token = getServerAccessToken()
  const baseUrl = getWorkspaceApiBaseUrl()
  const path = 'workItems/files/download'
  const url = `${baseUrl}/${path}?file_id=${fileId}`

  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  // 유효한 캐시가 있고 expectedUpdatedAt이 일치하거나 지정되지 않은 경우에만 If-Modified-Since 사용
  if (validCache?.lastModified && (!options?.expectedUpdatedAt || validCache.lastModified === options.expectedUpdatedAt)) {
    headers['If-Modified-Since'] = validCache.lastModified
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    // 304 Not Modified: 서버에 변경사항 없음 -> 로컬 캐시 즉시 반환
    if (response.status === 304 && validCache) {
      return {
        content: validCache.content,
        fromCache: true,
        lastModified: validCache.lastModified,
      }
    }

    if (!response.ok) {
      throw new Error(`파일 다운로드 실패 (HTTP ${response.status})`)
    }

    const textContent = await response.text()
    const serverLastModified = response.headers.get('Last-Modified') || options?.expectedUpdatedAt || new Date().toISOString()

    await setCachedFileContent({
      fileId,
      fileName: options?.expectedFileName || `file_${fileId}`,
      content: textContent,
      lastModified: serverLastModified,
      cachedAt: Date.now(),
    })

    return {
      content: textContent,
      fromCache: false,
      lastModified: serverLastModified,
    }
  } catch (error) {
    // 네트워크 오류 등으로 실패했지만 기존 캐시가 있다면 캐시 반환
    if (validCache) {
      console.warn('[fileService] 네트워크 요청 실패, 캐시 반환:', error)
      return { content: validCache.content, fromCache: true, lastModified: validCache.lastModified }
    }
    throw error
  }
}

