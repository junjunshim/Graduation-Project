import { ApiClientError, apiRequest } from './server/apiClient.js'
import { isServerStatusResponse, parseServerContextItems, type ServerStatusResponse } from './server/apiTypes.js'
import { notifyGithubCacheUpdated } from './workspaceCacheEvents.js'

export type GithubRepository = {
  repo_id: number
  node_id: number
  owner_login: string
  repo_name: string
  clone_url: string
  default_branch: string
  local_path: string
  is_deleted: boolean
  created_at?: string
  updated_at?: string
}

export type GithubTreeEntry = {
  name: string
  path: string
  type: 'dir' | 'file' | 'submodule'
  size?: number
}

export type GithubFileContent = {
  repo_id: number
  branch: string
  path: string
  size: number
  encoding: string
  read_only: boolean
  /** read_only 이유: 'too_large' | 'binary' */
  reason?: string
  /** false 가 아닐 때만 내용이 실려 온다. true 면 서버가 내용을 생략했다(바이너리·열람 상한 초과). */
  content_omitted?: boolean
  content?: string
  eol?: string
  /** 이 파일이 마지막으로 바뀐 시각(ISO 8601). 다음 조회의 캐시 검증 토큰으로 그대로 되돌려 보낸다. */
  modified_at?: string | null
  /** false 면 서버가 내용을 생략한 캐시 응답이다(내용이 바뀌지 않았다는 뜻). */
  changed?: boolean
}

/** 파일 조회 결과. changed=false 는 "캐시가 최신이라 내용을 보내지 않았다" 는 뜻이다. */
export type GithubFileFetchResult = { changed: true; file: GithubFileContent } | { changed: false }

export type GithubBranchPresence = {
  email: string
  name?: string
  connection_id?: string
  connected_at?: string
  last_seen_at?: string
}

export type GithubBranch = {
  name: string
  is_default: boolean
  /** 우리가 만든 브랜치(worktree 존재)인지. 원격에만 있는 브랜치는 false 다. */
  is_registered?: boolean
  branch_id?: number
  base_branch?: string | null
  worktree_path?: string
  work_item_id?: string | null
  work_item_display_id?: string | null
  presence: GithubBranchPresence[]
}

export type GithubCommit = {
  sha: string
  /** 부모 SHA. 2개 이상이면 머지 커밋이라 그래프가 레인을 나눈다. */
  parents: string[]
  subject: string
  author_name: string
  author_email: string
  authored_at: string
  /** "HEAD -> main", "origin/main", "tag: v1" 같은 장식. 서버가 git 을 그대로 옮긴다. */
  refs: string[]
}

export type GithubCredentialStatus = {
  has_credential: boolean
  github_login?: string | null
  token_type?: string | null
  scopes?: string | null
  expires_at?: string | null
  updated_at?: string | null
}

export type GithubHandoff = {
  code: string
  node_id: number
  repo_id: number
  expires_at?: string
  expires_in?: number
}

/** 서버가 돌려준 `Pxxxx` 코드를 UI 가 구분할 수 있게 보존한다(§12.12). */
export class GithubServiceError extends Error {
  readonly code?: string | number

  constructor(message: string, code?: string | number) {
    super(message)
    this.name = 'GithubServiceError'
    this.code = code
  }
}

function toServiceError(error: unknown, fallback: string): GithubServiceError {
  if (error instanceof GithubServiceError) {
    return error
  }

  if (error instanceof ApiClientError) {
    return new GithubServiceError(error.message || fallback, error.code)
  }

  return new GithubServiceError(error instanceof Error ? error.message : fallback)
}

function assertSuccess(response: unknown, fallback: string) {
  if (!isServerStatusResponse(response)) {
    throw new GithubServiceError(fallback)
  }

  if (response.status === 'error') {
    throw new GithubServiceError(response.message || fallback, response.code)
  }
}

function allItems<T>(response: unknown, fallback: string): T[] {
  assertSuccess(response, fallback)
  return parseServerContextItems((response as ServerStatusResponse).data) as unknown as T[]
}

function firstItem<T>(response: unknown, fallback: string): T | null {
  const items = allItems<T>(response, fallback)
  return items[0] ?? null
}

const LOCAL_STORAGE_GITHUB_REPOS_KEY = 'grad_github_repos_cache'
const LOCAL_STORAGE_GITHUB_CACHED_NODES_KEY = 'grad_github_cached_nodes'

function getCachedNodeSet(): Set<number> {
  if (typeof window === 'undefined' || !window.localStorage) return new Set()
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_CACHED_NODES_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as number[])
  } catch {
    return new Set()
  }
}

function markNodeCached(nodeId: number) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const set = getCachedNodeSet()
    set.add(nodeId)
    window.localStorage.setItem(LOCAL_STORAGE_GITHUB_CACHED_NODES_KEY, JSON.stringify(Array.from(set)))
  } catch {
    // ignore
  }
}

export function hasCachedRepositories(nodeId: number): boolean {
  return getCachedNodeSet().has(nodeId)
}

export function getLocalRepositories(nodeId?: number): GithubRepository[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_REPOS_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as GithubRepository[]
    if (nodeId !== undefined) {
      return list.filter((r) => r.node_id === nodeId && !r.is_deleted)
    }
    return list.filter((r) => !r.is_deleted)
  } catch {
    return []
  }
}

export function saveLocalRepositories(repos: GithubRepository[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_GITHUB_REPOS_KEY, JSON.stringify(repos))
  } catch {
    // ignore
  }
}

/** 노드에 연결된 저장소 목록 */
export async function fetchRepositories(nodeId: number): Promise<GithubRepository[]> {
  try {
    const response = await apiRequest<unknown>(`/github/repos?node_id=${encodeURIComponent(String(nodeId))}`)
    const list = allItems<GithubRepository>(response, '저장소 목록을 불러오지 못했습니다.')
    // 로컬 캐시 덮어쓰기 (현재 노드에 해당하는 저장소들을 새 목록으로 완전 교체)
    const currentOtherNodes = getLocalRepositories().filter((r) => r.node_id !== nodeId)
    saveLocalRepositories([...currentOtherNodes, ...list])
    markNodeCached(nodeId)
    return list
  } catch (error) {
    const cached = getLocalRepositories(nodeId)
    if (cached.length > 0 || hasCachedRepositories(nodeId)) {
      return cached
    }
    throw toServiceError(error, '저장소 목록을 불러오지 못했습니다.')
  }
}

/** 원격 저장소 연결 + 서버 clone */
export async function connectRepository(input: {
  nodeId: number
  ownerLogin: string
  repoName: string
}): Promise<GithubRepository> {
  try {
    const response = await apiRequest<unknown>('/github/repos', {
      method: 'POST',
      body: {
        node_id: input.nodeId,
        owner_login: input.ownerLogin.trim(),
        repo_name: input.repoName.trim(),
      },
    })
    const repository = firstItem<GithubRepository>(response, '저장소를 연결하지 못했습니다.')

    if (!repository) {
      throw new GithubServiceError('저장소 연결 결과를 확인하지 못했습니다.')
    }

    const current = getLocalRepositories().filter((r) => r.repo_id !== repository.repo_id)
    saveLocalRepositories([...current, repository])
    notifyGithubCacheUpdated(input.nodeId)

    return repository
  } catch (error) {
    throw toServiceError(error, '저장소를 연결하지 못했습니다.')
  }
}

/** 연결 해제(서버 로컬 clone 은 남긴다) */
export async function disconnectRepository(repoId: number): Promise<void> {
  try {
    // 서버 DELETE 라우트는 본문이 아니라 쿼리 파라미터(repo_id)를 읽는다.
    const response = await apiRequest<unknown>(`/github/repos?repo_id=${encodeURIComponent(String(repoId))}`, {
      method: 'DELETE',
    })
    assertSuccess(response, '저장소 연결을 해제하지 못했습니다.')

    const all = getLocalRepositories()
    const target = all.find((r) => r.repo_id === repoId)
    saveLocalRepositories(all.filter((r) => r.repo_id !== repoId))
    notifyGithubCacheUpdated(target?.node_id)
  } catch (error) {
    throw toServiceError(error, '저장소 연결을 해제하지 못했습니다.')
  }
}

const LOCAL_STORAGE_GITHUB_TREE_KEY = 'grad_github_tree_cache'

export function getLocalTree(repoId: number, branch: string, path: string = ''): GithubTreeEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_TREE_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, GithubTreeEntry[]>
    return map[`${repoId}:${branch}:${path}`] ?? []
  } catch {
    return []
  }
}

export function saveLocalTree(repoId: number, branch: string, path: string = '', entries: GithubTreeEntry[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_TREE_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, GithubTreeEntry[]>) : {}
    map[`${repoId}:${branch}:${path}`] = entries
    window.localStorage.setItem(LOCAL_STORAGE_GITHUB_TREE_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

/** 디렉터리 한 단계(파일 내용 제외, lazy) */
export async function fetchRepositoryTree(input: {
  repoId: number
  branch: string
  path?: string
}): Promise<GithubTreeEntry[]> {
  const query = new URLSearchParams({ repo_id: String(input.repoId) })

  if (input.branch) {
    query.set('branch', input.branch)
  }

  if (input.path) {
    query.set('path', input.path)
  }

  try {
    const response = await apiRequest<unknown>(`/github/repos/tree?${query.toString()}`)
    const list = allItems<GithubTreeEntry>(response, '저장소 구조를 불러오지 못했습니다.')
    if (input.branch) {
      saveLocalTree(input.repoId, input.branch, input.path ?? '', list)
    }
    return list
  } catch (error) {
    if (input.branch) {
      const cached = getLocalTree(input.repoId, input.branch, input.path ?? '')
      if (cached.length > 0) {
        return cached
      }
    }
    throw toServiceError(error, '저장소 구조를 불러오지 못했습니다.')
  }
}

/** 파일 내용(저장소 자세히 보기 전용 — 편집 경로에서는 쓰지 않는다) */
export async function fetchRepositoryFile(input: {
  repoId: number
  branch: string
  path: string
  /** 직전 응답의 modified_at. 서버는 이 시각과 같으면 내용을 생략하고 changed=false 만 돌려준다. */
  since?: string | null
}): Promise<GithubFileFetchResult> {
  const query = new URLSearchParams({
    repo_id: String(input.repoId),
    branch: input.branch,
    path: input.path,
  })

  if (input.since) {
    query.set('since', input.since)
  }

  try {
    const response = await apiRequest<unknown>(`/github/repos/file?${query.toString()}`)
    const file = firstItem<GithubFileContent>(response, '파일 내용을 불러오지 못했습니다.')

    if (!file) {
      throw new GithubServiceError('파일 내용을 확인하지 못했습니다.')
    }

    if (file.changed === false) {
      return { changed: false }
    }

    return { changed: true, file }
  } catch (error) {
    throw toServiceError(error, '파일 내용을 불러오지 못했습니다.')
  }
}

const LOCAL_STORAGE_GITHUB_BRANCHES_KEY = 'grad_github_branches_cache'
const LOCAL_STORAGE_GITHUB_COMMITS_KEY = 'grad_github_commits_cache'

export function getLocalBranches(repoId: number): GithubBranch[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_BRANCHES_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, GithubBranch[]>
    return map[String(repoId)] ?? []
  } catch {
    return []
  }
}

export function saveLocalBranches(repoId: number, branches: GithubBranch[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_BRANCHES_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, GithubBranch[]>) : {}
    map[String(repoId)] = branches
    window.localStorage.setItem(LOCAL_STORAGE_GITHUB_BRANCHES_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

export function getLocalCommits(repoId: number, branch: string): GithubCommit[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_COMMITS_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, GithubCommit[]>
    return map[`${repoId}:${branch}`] ?? []
  } catch {
    return []
  }
}

export function saveLocalCommits(repoId: number, branch: string, commits: GithubCommit[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_GITHUB_COMMITS_KEY)
    const map = raw ? (JSON.parse(raw) as Record<string, GithubCommit[]>) : {}
    map[`${repoId}:${branch}`] = commits
    window.localStorage.setItem(LOCAL_STORAGE_GITHUB_COMMITS_KEY, JSON.stringify(map))
  } catch {
    // ignore
  }
}

/** 등록 브랜치 + 원격 브랜치 + 접속자 */
export async function fetchBranches(repoId: number): Promise<GithubBranch[]> {
  try {
    const response = await apiRequest<unknown>(`/github/repos/branches?repo_id=${encodeURIComponent(String(repoId))}`)
    const list = allItems<GithubBranch>(response, '브랜치 목록을 불러오지 못했습니다.')
    saveLocalBranches(repoId, list)
    return list
  } catch (error) {
    const cached = getLocalBranches(repoId)
    if (cached.length > 0) {
      return cached
    }
    throw toServiceError(error, '브랜치 목록을 불러오지 못했습니다.')
  }
}

/**
 * 커밋 그래프. 서버 로컬 clone 의 실제 git 이력이라 GitHub 자격증명이 필요 없다.
 * limit 은 서버가 1~200 으로 자른다(기본 50).
 */
export async function fetchRepositoryCommits(input: {
  repoId: number
  branch: string
  limit?: number
}): Promise<GithubCommit[]> {
  const query = new URLSearchParams({ repo_id: String(input.repoId) })

  if (input.branch) {
    query.set('branch', input.branch)
  }

  if (input.limit) {
    query.set('limit', String(input.limit))
  }

  try {
    const response = await apiRequest<unknown>(`/github/repos/commits?${query.toString()}`)
    const list = allItems<GithubCommit>(response, '커밋 기록을 불러오지 못했습니다.')
    if (input.branch) {
      saveLocalCommits(input.repoId, input.branch, list)
    }
    return list
  } catch (error) {
    if (input.branch) {
      const cached = getLocalCommits(input.repoId, input.branch)
      if (cached.length > 0) {
        return cached
      }
    }
    throw toServiceError(error, '커밋 기록을 불러오지 못했습니다.')
  }
}

/** 내 GitHub 자격증명(PAT) 상태 — 토큰 자체는 서버가 돌려주지 않는다 */
export async function fetchCredentialStatus(): Promise<GithubCredentialStatus> {
  try {
    const response = await apiRequest<unknown>('/github/credentials')
    const status = firstItem<GithubCredentialStatus>(response, 'GitHub 자격증명 상태를 불러오지 못했습니다.')

    return status ?? { has_credential: false }
  } catch (error) {
    throw toServiceError(error, 'GitHub 자격증명 상태를 불러오지 못했습니다.')
  }
}

/** PAT 등록 — 서버가 GitHub API 로 검증한 뒤 암호화해 저장한다 */
export async function registerCredential(token: string): Promise<GithubCredentialStatus> {
  try {
    const response = await apiRequest<unknown>('/github/credentials', {
      method: 'POST',
      body: { token: token.trim() },
    })
    const status = firstItem<GithubCredentialStatus>(response, 'GitHub 자격증명을 등록하지 못했습니다.')

    return status ?? { has_credential: true }
  } catch (error) {
    throw toServiceError(error, 'GitHub 자격증명을 등록하지 못했습니다.')
  }
}

/** PAT 연결 해제 */
export async function disconnectCredential(): Promise<void> {
  try {
    const response = await apiRequest<unknown>('/github/credentials', { method: 'DELETE' })
    assertSuccess(response, 'GitHub 자격증명 연결을 해제하지 못했습니다.')
  } catch (error) {
    throw toServiceError(error, 'GitHub 자격증명 연결을 해제하지 못했습니다.')
  }
}

/** 앱 → 확장 1회용 핸드오프 코드 발급(TTL 약 60초) */
export async function createHandoffCode(input: { nodeId: number; repoId: number }): Promise<GithubHandoff> {
  try {
    const response = await apiRequest<unknown>('/github/handoff', {
      method: 'POST',
      body: { node_id: input.nodeId, repo_id: input.repoId },
    })
    const handoff = firstItem<GithubHandoff>(response, '확장 연결 코드를 발급하지 못했습니다.')

    if (!handoff || !handoff.code) {
      throw new GithubServiceError('확장 연결 코드를 발급하지 못했습니다.')
    }

    return handoff
  } catch (error) {
    throw toServiceError(error, '확장 연결 코드를 발급하지 못했습니다.')
  }
}