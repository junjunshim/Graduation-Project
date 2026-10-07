import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  connectRepository,
  createHandoffCode,
  disconnectCredential,
  disconnectRepository,
  fetchBranches,
  fetchCredentialStatus,
  fetchRepositories,
  fetchRepositoryFile,
  fetchRepositoryTree,
  registerCredential,
  type GithubBranch,
  type GithubCredentialStatus,
  type GithubFileContent,
  type GithubRepository,
  type GithubTreeEntry,
} from '../data/githubService'
import { detectVscodeEnvironment, openExternalUrl } from '../data/openExternal'
import {
  AXIS_SHARE_EXTENSION_ID,
  buildHandoffUri,
  describeVscodeLaunchFailure,
  describeVscodeWarning,
  getVscodeScheme,
} from '../model/vscodeLink'
import styles from './WorkspaceGithubTab.module.css'

type WorkspaceGithubTabProps = {
  nodeId: number
}

function formatFileSize(bytes: number) {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${parseFloat((bytes / 1024 ** index).toFixed(1))} ${units[index]}`
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

/** 디렉터리를 먼저, 그 다음 파일 순으로(GitHub 웹과 같은 순서) */
function sortEntries(entries: GithubTreeEntry[]) {
  return [...entries].sort((left, right) => {
    const rankDiff = (left.type === 'dir' ? 0 : 1) - (right.type === 'dir' ? 0 : 1)

    if (rankDiff !== 0) {
      return rankDiff
    }

    return left.name.localeCompare(right.name)
  })
}

function pathSegments(path: string) {
  return path.split('/').filter(Boolean)
}

/** 파일 캐시 키. 브랜치가 다르면 같은 경로라도 다른 내용이다. */
function fileCacheKey(repoId: number, branch: string, path: string) {
  return `${repoId}:${branch}:${path}`
}

type CachedFile = {
  file: GithubFileContent
  /** 서버가 준 마지막 수정 시각. 다음 조회에 이 값을 그대로 since 로 돌려보낸다. */
  modifiedAt: string
}

/** 표시할 브랜치를 고른다. 지정 브랜치가 없으면 기본 브랜치, 그다음 첫 브랜치. */
function pickBranch(branches: GithubBranch[], preferred?: string) {
  if (preferred && branches.some((branch) => branch.name === preferred)) {
    return preferred
  }

  return branches.find((branch) => branch.is_default)?.name ?? branches[0]?.name ?? ''
}

/**
 * 워크스페이스 상세의 GitHub 탭 (TASK_11 §1.3-1~3, §4.2).
 * 저장소 연결/해제, 서버 로컬 저장소 자세히 보기(구조·브랜치), PAT 자격증명,
 * "VSCode 로 실시간 편집" 핸드오프까지를 맡는다. 편집·커밋은 확장이 한다.
 */
export function WorkspaceGithubTab({ nodeId }: WorkspaceGithubTabProps) {
  // 저장소 목록
  const [repositories, setRepositories] = useState<GithubRepository[]>([])
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [reposError, setReposError] = useState<string | null>(null)
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null)
  const [pendingDisconnectRepoId, setPendingDisconnectRepoId] = useState<number | null>(null)
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  // 저장소 연결 폼
  const [isConnectFormOpen, setIsConnectFormOpen] = useState(false)
  const [ownerLogin, setOwnerLogin] = useState('')
  const [repoName, setRepoName] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // PAT 자격증명
  const [credential, setCredential] = useState<GithubCredentialStatus | null>(null)
  const [patInput, setPatInput] = useState('')
  const [isSavingPat, setIsSavingPat] = useState(false)
  const [credentialError, setCredentialError] = useState<string | null>(null)

  // 저장소 상세(브랜치·구조)
  const [branches, setBranches] = useState<GithubBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<GithubTreeEntry[]>([])
  const [isLoadingEntries, setIsLoadingEntries] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailRefreshToken, setDetailRefreshToken] = useState(0)

  // 파일 미리보기
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<GithubFileContent | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // VSCode 핸드오프
  const [isOpeningVscode, setIsOpeningVscode] = useState(false)
  const [vscodeNotice, setVscodeNotice] = useState<string | null>(null)

  // 브랜치 비교에 쓰려고 최신 값을 ref 로도 들고 있는다(콜백 재생성 방지).
  const currentBranchRef = useRef('')
  const fileRequestId = useRef(0)

  // 받아 둔 파일 내용. 서버가 시각으로 검증하므로 낡은 값이 그대로 화면에 남지 않는다.
  const fileCache = useRef<Map<string, CachedFile>>(new Map())

  useEffect(() => {
    currentBranchRef.current = currentBranch
  }, [currentBranch])

  const selectedRepository = useMemo(
    () => repositories.find((repository) => repository.repo_id === selectedRepoId) ?? null,
    [repositories, selectedRepoId],
  )

  const activeBranch = useMemo(
    () => branches.find((branch) => branch.name === currentBranch) ?? null,
    [branches, currentBranch],
  )

  const sortedEntries = useMemo(() => sortEntries(entries), [entries])

  const reloadRepositories = useCallback(async () => {
    setIsLoadingRepos(true)
    setReposError(null)

    try {
      const list = await fetchRepositories(nodeId)
      setRepositories(list)
      setSelectedRepoId((current) => {
        if (current !== null && list.some((repository) => repository.repo_id === current)) {
          return current
        }

        return list.length > 0 ? list[0].repo_id : null
      })
    } catch (error) {
      setRepositories([])
      setSelectedRepoId(null)
      setReposError(errorMessage(error, '저장소 목록을 불러오지 못했습니다.'))
    } finally {
      setIsLoadingRepos(false)
    }
  }, [nodeId])

  useEffect(() => {
    void reloadRepositories()
  }, [reloadRepositories])

  useEffect(() => {
    let isSubscribed = true

    void fetchCredentialStatus()
      .then((status) => {
        if (isSubscribed) {
          setCredential(status)
          setCredentialError(null)
        }
      })
      .catch((error) => {
        if (isSubscribed) {
          setCredential(null)
          setCredentialError(errorMessage(error, 'GitHub 자격증명 상태를 불러오지 못했습니다.'))
        }
      })

    return () => {
      isSubscribed = false
    }
  }, [])

  const reloadBranches = useCallback(async (repoId: number, preferred?: string) => {
    setDetailError(null)

    try {
      const list = await fetchBranches(repoId)
      const next = pickBranch(list, preferred)
      const previous = currentBranchRef.current

      setBranches(list)
      setCurrentBranch(next)

      // 브랜치가 바뀌면 경로가 무효가 되므로 처음으로 돌아간다.
      if (previous !== next) {
        setCurrentPath('')
        setPreviewPath(null)
        setPreviewFile(null)
        setFileError(null)
      }
    } catch (error) {
      setBranches([])
      setCurrentBranch('')
      setEntries([])
      setPreviewPath(null)
      setPreviewFile(null)
      setDetailError(errorMessage(error, '브랜치 목록을 불러오지 못했습니다.'))
    }
  }, [])

  // 선택 저장소가 바뀌면 브랜치/구조를 새로 읽는다.
  useEffect(() => {
    if (selectedRepoId === null) {
      setBranches([])
      setCurrentBranch('')
      setCurrentPath('')
      setEntries([])
      setPreviewPath(null)
      setPreviewFile(null)
      setDetailError(null)
      return
    }

    const repository = repositories.find((item) => item.repo_id === selectedRepoId)
    void reloadBranches(selectedRepoId, currentBranchRef.current || repository?.default_branch)
  }, [selectedRepoId, repositories, reloadBranches])

  // 현재 경로 한 단계를 lazy 로 읽는다(§12.3).
  useEffect(() => {
    if (selectedRepoId === null || !currentBranch) {
      setEntries([])
      return
    }

    let isSubscribed = true

    setIsLoadingEntries(true)
    setDetailError(null)

    void fetchRepositoryTree({ repoId: selectedRepoId, branch: currentBranch, path: currentPath })
      .then((list) => {
        if (isSubscribed) {
          setEntries(list)
        }
      })
      .catch((error) => {
        if (isSubscribed) {
          setEntries([])
          setDetailError(errorMessage(error, '저장소 구조를 불러오지 못했습니다.'))
        }
      })
      .finally(() => {
        if (isSubscribed) {
          setIsLoadingEntries(false)
        }
      })

    return () => {
      isSubscribed = false
    }
  }, [selectedRepoId, currentBranch, currentPath, detailRefreshToken])

  const handleSelectRepository = (repoId: number) => {
    if (repoId === selectedRepoId) {
      return
    }

    setSelectedRepoId(repoId)
    setCurrentPath('')
    setPreviewPath(null)
    setPreviewFile(null)
    setFileError(null)
    setDetailError(null)
    setVscodeNotice(null)
    setPendingDisconnectRepoId(null)
  }

  const handleSelectBranch = (branch: string) => {
    if (branch === currentBranch) {
      return
    }

    setCurrentBranch(branch)
    setCurrentPath('')
    setPreviewPath(null)
    setPreviewFile(null)
    setFileError(null)
    setVscodeNotice(null)
  }

  const handleNavigate = (path: string) => {
    setCurrentPath(path)
    setPreviewPath(null)
    setPreviewFile(null)
    setFileError(null)
  }

  const handleRefreshDetail = async () => {
    if (selectedRepoId === null) {
      return
    }

    await reloadBranches(selectedRepoId, currentBranchRef.current || undefined)
    setDetailRefreshToken((token) => token + 1)
  }

  const handleOpenFile = async (entry: GithubTreeEntry) => {
    if (selectedRepoId === null || !currentBranch) {
      return
    }

    fileRequestId.current += 1
    const requestId = fileRequestId.current
    const repoId = selectedRepoId
    const branch = currentBranch
    const cacheKey = fileCacheKey(repoId, branch, entry.path)
    const cached = fileCache.current.get(cacheKey)

    setPreviewPath(entry.path)
    setPreviewFile(null)
    setFileError(null)
    setIsLoadingFile(true)

    // 검증 토큰은 서버가 준 시각을 그대로 쓴다(클라이언트 시계 오차가 끼지 않게).
    const applyFile = (file: GithubFileContent) => {
      fileCache.current.set(cacheKey, { file, modifiedAt: file.modified_at ?? '' })
      setPreviewFile(file)
    }

    try {
      const result = await fetchRepositoryFile({
        repoId,
        branch,
        path: entry.path,
        since: cached?.modifiedAt,
      })

      if (fileRequestId.current !== requestId) {
        return
      }

      if (result.changed) {
        applyFile(result.file)
        return
      }

      if (cached) {
        // 서버가 "안 바뀌었다" 고 했으므로 받아 둔 내용을 그대로 보여준다.
        setPreviewFile(cached.file)
        return
      }

      // 예외 경로: 서버는 "안 바뀜" 인데 우리에게 캐시가 없다(캐시 유실). 이때만 since 없이 한 번 더 받는다.
      const fresh = await fetchRepositoryFile({ repoId, branch, path: entry.path })

      if (fileRequestId.current === requestId && fresh.changed) {
        applyFile(fresh.file)
      }
    } catch (error) {
      if (fileRequestId.current === requestId) {
        setFileError(errorMessage(error, '파일 내용을 불러오지 못했습니다.'))
      }
    } finally {
      if (fileRequestId.current === requestId) {
        setIsLoadingFile(false)
      }
    }
  }

  const handleConnect = async () => {
    const owner = ownerLogin.trim()
    const name = repoName.trim()

    if (!owner || !name) {
      setConnectError('소유자와 저장소 이름을 모두 입력해 주세요.')
      return
    }

    setIsConnecting(true)
    setConnectError(null)

    try {
      const repository = await connectRepository({ nodeId, ownerLogin: owner, repoName: name })
      setIsConnectFormOpen(false)
      setOwnerLogin('')
      setRepoName('')
      await reloadRepositories()
      setSelectedRepoId(repository.repo_id)
    } catch (error) {
      setConnectError(errorMessage(error, '저장소를 연결하지 못했습니다.'))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async (repoId: number) => {
    setIsDisconnecting(true)
    setReposError(null)

    try {
      await disconnectRepository(repoId)
      setPendingDisconnectRepoId(null)
      await reloadRepositories()
    } catch (error) {
      setReposError(errorMessage(error, '저장소 연결을 해제하지 못했습니다.'))
    } finally {
      setIsDisconnecting(false)
    }
  }

  const handleSavePat = async () => {
    const token = patInput.trim()

    if (!token) {
      setCredentialError('토큰을 입력해 주세요.')
      return
    }

    setIsSavingPat(true)
    setCredentialError(null)

    try {
      const status = await registerCredential(token)
      setCredential(status)
      setPatInput('')
    } catch (error) {
      setCredentialError(errorMessage(error, 'GitHub 자격증명을 등록하지 못했습니다.'))
    } finally {
      setIsSavingPat(false)
    }
  }

  const handleDisconnectCredential = async () => {
    setIsSavingPat(true)
    setCredentialError(null)

    try {
      await disconnectCredential()
      setCredential({ has_credential: false })
    } catch (error) {
      setCredentialError(errorMessage(error, 'GitHub 자격증명 연결을 해제하지 못했습니다.'))
    } finally {
      setIsSavingPat(false)
    }
  }

  const handleOpenInVscode = async () => {
    if (!selectedRepository) {
      return
    }

    setIsOpeningVscode(true)
    setVscodeNotice(null)

    try {
      // 1) 1회용 코드를 받아 2) VSCode 설치·확장 여부를 확인하고 3) URI 로 연다(§3.4).
      const handoff = await createHandoffCode({ nodeId, repoId: selectedRepository.repo_id })
      const detection = await detectVscodeEnvironment(AXIS_SHARE_EXTENSION_ID)
      const uri = buildHandoffUri({
        scheme: getVscodeScheme(detection.cli),
        repoId: selectedRepository.repo_id,
        nodeId,
        code: handoff.code,
      })
      const opened = await openExternalUrl(uri)

      if (!opened) {
        setVscodeNotice(describeVscodeLaunchFailure(detection))
        return
      }

      setVscodeNotice(describeVscodeWarning(detection) ?? 'VSCode 에서 확장이 열렸습니다. 확장 창에서 연결 상태를 확인해 주세요.')
    } catch (error) {
      setVscodeNotice(errorMessage(error, 'VSCode 로 여는데 실패했습니다.'))
    } finally {
      setIsOpeningVscode(false)
    }
  }

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <section className={styles.sidebarSection}>
          <div className={styles.sectionTitle}>
            <span>저장소</span>
            <Button
              variant="icon"
              aria-label="저장소 목록 새로고침"
              onClick={() => void reloadRepositories()}
              disabled={isLoadingRepos}
            >
              <Icon name="rotateCcw" size={15} />
            </Button>
          </div>

          {isLoadingRepos ? <p className={styles.mutedText}>저장소 목록을 불러오는 중…</p> : null}
          {reposError ? <p className={styles.errorText}>{reposError}</p> : null}
          {!isLoadingRepos && !reposError && repositories.length === 0 ? (
            <p className={styles.mutedText}>아직 연결된 저장소가 없습니다. 아래에서 원격 저장소를 연결하세요.</p>
          ) : null}

          {repositories.length > 0 ? (
            <ul className={styles.repoList}>
              {repositories.map((repository) => (
                <li
                  key={repository.repo_id}
                  className={[styles.repoItem, repository.repo_id === selectedRepoId ? styles.repoItemActive : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <button
                    type="button"
                    className={styles.repoSelect}
                    onClick={() => handleSelectRepository(repository.repo_id)}
                  >
                    <span className={styles.repoName}>{repository.repo_name}</span>
                    <span className={styles.repoOwner}>
                      {repository.owner_login} · {repository.default_branch}
                    </span>
                  </button>

                  {pendingDisconnectRepoId === repository.repo_id ? (
                    <div className={styles.formActions}>
                      <Button
                        variant="icon"
                        aria-label="연결 해제 확인"
                        onClick={() => void handleDisconnect(repository.repo_id)}
                        disabled={isDisconnecting}
                      >
                        <Icon name="checkCircle" size={15} />
                      </Button>
                      <Button
                        variant="icon"
                        aria-label="연결 해제 취소"
                        onClick={() => setPendingDisconnectRepoId(null)}
                      >
                        <Icon name="close" size={15} />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="icon"
                      aria-label={`${repository.repo_name} 연결 해제`}
                      onClick={() => setPendingDisconnectRepoId(repository.repo_id)}
                    >
                      <Icon name="trash" size={15} />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {isConnectFormOpen ? (
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault()
                void handleConnect()
              }}
            >
              <label className={styles.field}>
                <span className={styles.fieldLabel}>소유자 (owner)</span>
                <input
                  className={styles.input}
                  value={ownerLogin}
                  onChange={(event) => setOwnerLogin(event.target.value)}
                  placeholder="axisflow"
                  autoFocus
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>저장소 이름 (repository)</span>
                <input
                  className={styles.input}
                  value={repoName}
                  onChange={(event) => setRepoName(event.target.value)}
                  placeholder="demo"
                />
              </label>
              {connectError ? <p className={styles.errorText}>{connectError}</p> : null}
              <div className={styles.formActions}>
                <Button type="submit" variant="primary" disabled={isConnecting}>
                  {isConnecting ? '연결 중…' : '연결'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsConnectFormOpen(false)
                    setConnectError(null)
                  }}
                >
                  취소
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setIsConnectFormOpen(true)}>
              <Icon name="plus" size={15} />
              저장소 연결
            </Button>
          )}
        </section>

        <section className={styles.sidebarSection}>
          <div className={styles.sectionTitle}>
            <span>GitHub 자격증명</span>
          </div>

          {credential?.has_credential ? (
            <>
              <div className={styles.credentialRow}>
                <span className={styles.credentialLogin}>
                  <Icon name="checkCircle" size={14} />
                  {credential.github_login || '연결됨'}
                </span>
                <Button variant="secondary" onClick={() => void handleDisconnectCredential()} disabled={isSavingPat}>
                  해제
                </Button>
              </div>
              <p className={styles.mutedText}>
                {credential.scopes ? `스코프: ${credential.scopes}` : '스코프 정보 없음'}
                {credential.expires_at ? ` · 만료: ${credential.expires_at}` : ''}
              </p>
            </>
          ) : (
            <>
              <p className={styles.mutedText}>
                PAT(personal access token)를 등록하면 비공개 저장소 clone 과 push 가 가능합니다. &quot;repo&quot; 스코프가 필요합니다.
              </p>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Personal access token</span>
                <input
                  className={styles.input}
                  type="password"
                  value={patInput}
                  onChange={(event) => setPatInput(event.target.value)}
                  placeholder="ghp_..."
                  autoComplete="off"
                />
              </label>
              <div className={styles.formActions}>
                <Button variant="primary" onClick={() => void handleSavePat()} disabled={isSavingPat}>
                  {isSavingPat ? '등록 중…' : '등록'}
                </Button>
              </div>
            </>
          )}

          {credentialError ? <p className={styles.errorText}>{credentialError}</p> : null}
        </section>
      </aside>

      <div className={styles.content}>
        {!selectedRepository ? (
          <div className={styles.emptyState}>
            <Icon name="database" size={26} />
            <p>왼쪽에서 원격 저장소를 연결하거나 선택하세요.</p>
            <p className={styles.mutedText}>
              연결하면 서버가 저장소를 clone 하고, 구조와 브랜치를 여기에서 볼 수 있습니다.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.toolbarLeft}>
                <span className={styles.repoTitle}>
                  <span className={styles.repoTitleOwner}>{selectedRepository.owner_login}/</span>
                  {selectedRepository.repo_name}
                </span>

                {branches.length > 0 ? (
                  <select
                    className={styles.branchSelect}
                    value={currentBranch}
                    onChange={(event) => handleSelectBranch(event.target.value)}
                    aria-label="브랜치 선택"
                  >
                    {branches.map((branch) => (
                      <option key={branch.name} value={branch.name}>
                        {branch.name}
                        {branch.is_default ? ' (기본)' : ''}
                      </option>
                    ))}
                  </select>
                ) : null}

                {activeBranch && activeBranch.presence.length > 0 ? (
                  <span className={styles.presenceChips}>
                    {activeBranch.presence.map((person) => (
                      <span key={person.email} className={styles.presenceChip}>
                        {person.name || person.email}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>

              <div className={styles.formActions}>
                <Button variant="secondary" onClick={() => void handleRefreshDetail()} disabled={isLoadingEntries}>
                  <Icon name="rotateCcw" size={15} />
                  새로고침
                </Button>
                <Button variant="primary" onClick={() => void handleOpenInVscode()} disabled={isOpeningVscode}>
                  <Icon name="gear" size={15} />
                  {isOpeningVscode ? '여는 중…' : 'VSCode 로 실시간 편집'}
                </Button>
              </div>
            </div>

            {vscodeNotice ? <p className={styles.mutedText}>{vscodeNotice}</p> : null}
            {detailError ? <p className={styles.errorText}>{detailError}</p> : null}

            <nav className={styles.breadcrumb} aria-label="경로">
              <button type="button" className={styles.crumbButton} onClick={() => handleNavigate('')}>
                {selectedRepository.repo_name}
              </button>
              {pathSegments(currentPath).map((segment, index, segments) => {
                const target = segments.slice(0, index + 1).join('/')

                return (
                  <span key={target}>
                    <span className={styles.crumbSeparator}>/</span>
                    {index === segments.length - 1 ? (
                      <span className={styles.crumbCurrent}>{segment}</span>
                    ) : (
                      <button type="button" className={styles.crumbButton} onClick={() => handleNavigate(target)}>
                        {segment}
                      </button>
                    )}
                  </span>
                )
              })}
            </nav>

            <div className={styles.split}>
              <div className={styles.entryPanel}>
                {isLoadingEntries ? <p className={styles.entryEmpty}>불러오는 중…</p> : null}
                {!isLoadingEntries && sortedEntries.length === 0 && !detailError ? (
                  <p className={styles.entryEmpty}>표시할 파일이 없습니다.</p>
                ) : null}

                {sortedEntries.length > 0 ? (
                  <ul className={styles.entryList}>
                    {sortedEntries.map((entry) => (
                      <li key={entry.path}>
                        <button
                          type="button"
                          className={[styles.entryRow, entry.path === previewPath ? styles.entryRowActive : '']
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (entry.type === 'dir') {
                              handleNavigate(entry.path)
                              return
                            }

                            void handleOpenFile(entry)
                          }}
                        >
                          <Icon
                            name={entry.type === 'dir' ? 'folder' : 'fileText'}
                            size={15}
                            className={entry.type === 'dir' ? styles.entryIconDir : styles.entryIconFile}
                          />
                          <span className={styles.entryName}>{entry.name}</span>
                          <span className={styles.entryMeta}>
                            {entry.type === 'dir'
                              ? '폴더'
                              : entry.type === 'submodule'
                                ? '서브모듈'
                                : formatFileSize(entry.size ?? 0)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className={styles.previewPanel}>
                <div className={styles.previewHeader}>
                  <span className={styles.previewTitle}>{previewPath ?? '파일을 선택하세요'}</span>
                  {previewFile ? (
                    <span
                      className={[styles.badge, previewFile.read_only ? styles.badgeWarn : styles.badgeOk].join(' ')}
                    >
                      {previewFile.read_only ? '읽기 전용' : formatFileSize(previewFile.size)}
                    </span>
                  ) : previewPath ? (
                    <span className={[styles.badge, styles.badgeMuted].join(' ')}>{currentBranch}</span>
                  ) : null}
                </div>

                <div className={styles.previewBody}>
                  {isLoadingFile ? <p className={styles.previewNotice}>파일을 불러오는 중…</p> : null}
                  {fileError ? (
                    <p className={[styles.previewNotice, styles.errorText].join(' ')}>{fileError}</p>
                  ) : null}
                  {!isLoadingFile && !fileError && !previewFile ? (
                    <p className={styles.previewNotice}>
                      왼쪽에서 파일을 선택하면 내용을 보여줍니다. 실제 편집은 VSCode 로 실시간 편집에서 합니다.
                    </p>
                  ) : null}
                  {previewFile && !previewFile.read_only && previewFile.content !== undefined ? (
                    <pre className={styles.previewCode}>{previewFile.content}</pre>
                  ) : null}
                  {previewFile && previewFile.read_only ? (
                    <p className={styles.previewNotice}>
                      {previewFile.reason === 'binary'
                        ? '바이너리 파일이라 미리보기를 지원하지 않습니다.'
                        : '파일이 너무 커서 미리보기를 지원하지 않습니다.'}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}