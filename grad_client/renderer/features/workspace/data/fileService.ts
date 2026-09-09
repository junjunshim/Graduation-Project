import { apiRequest, getServerAccessToken } from './server/apiClient'
import { isServerStatusResponse } from './server/apiTypes'
import { getWorkspaceApiBaseUrl } from './server/workspaceMode.js'
import { isServerDataSource } from './workspaceMode'

export type CachedFileItem = {
  fileId: number
  fileName: string
  content: string
  lastModified?: string
  cachedAt: number
}

const FILE_CACHE_PREFIX = 'grad-file-cache-'

export async function downloadWorkItemFile(fileId: number, fileName: string): Promise<void> {
  if (!isServerDataSource()) {
    throw new Error('파일 다운로드는 서버 연결 모드에서 사용할 수 있습니다.')
  }
  const blob = await apiRequest<Blob>(`/workItems/files/download?file_id=${fileId}`, {
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

export async function uploadWorkItemFile(workItemId: string, file: File): Promise<void> {
  if (!isServerDataSource()) {
    throw new Error('파일 등록은 서버 연결 모드에서 사용할 수 있습니다.')
  }
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
}

function getCachedFile(fileId: number): CachedFileItem | null {
  try {
    const raw = localStorage.getItem(`${FILE_CACHE_PREFIX}${fileId}`)
    if (!raw) return null
    return JSON.parse(raw) as CachedFileItem
  } catch {
    return null
  }
}

function setCachedFile(item: CachedFileItem): void {
  try {
    localStorage.setItem(`${FILE_CACHE_PREFIX}${item.fileId}`, JSON.stringify(item))
  } catch (err) {
    console.warn('[fileService] 캐시 저장 실패:', err)
  }
}

export type FetchFileContentResult = {
  content: string
  fromCache: boolean
  lastModified?: string
}

/**
 * 서버에서 파일 내용을 가져옵니다.
 * 이전에 다운로드한 기록이 있다면 If-Modified-Since 헤더를 전송하여
 * 변경되지 않았을 시 304 응답을 받고 로컬 캐시 내용을 즉시 반환합니다.
 */
export async function fetchWorkItemFileContent(
  fileId: number,
  fallbackSampleText?: string,
): Promise<FetchFileContentResult> {
  const cached = getCachedFile(fileId)

  // 오프라인 / 모의 데이터 모드인 경우
  if (!isServerDataSource()) {
    if (cached) {
      return { content: cached.content, fromCache: true, lastModified: cached.lastModified }
    }
    const sample = fallbackSampleText || `# 문서 내용\n\n해당 파일은 데모 파일입니다.`
    setCachedFile({
      fileId,
      fileName: `file_${fileId}`,
      content: sample,
      cachedAt: Date.now(),
    })
    return { content: sample, fromCache: false }
  }

  const token = getServerAccessToken()
  const baseUrl = getWorkspaceApiBaseUrl()
  const path = 'workItems/files/download'
  const url = `${baseUrl}/${path}?file_id=${fileId}`

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

    // 304 Not Modified: 서버에 변경사항 없음 -> 로컬 캐시 즉시 반환
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

    setCachedFile({
      fileId,
      fileName: `file_${fileId}`,
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
    if (cached) {
      console.warn('[fileService] 네트워크 요청 실패, 캐시 반환:', error)
      return { content: cached.content, fromCache: true, lastModified: cached.lastModified }
    }
    throw error
  }
}
