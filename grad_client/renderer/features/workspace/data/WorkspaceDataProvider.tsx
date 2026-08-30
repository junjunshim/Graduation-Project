import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { hasServerSession } from './apiClient'
import { loadServerWorkspace, signOutServerUser } from './serverWorkspace'
import {
  getWorkspaceRuntimeConfiguration,
  type WorkspaceDataSource,
} from './workspaceMode'
import {
  subscribeToWorkspaceCache,
  subscribeToWorkspaceCacheRefreshFailure,
} from './workspaceCacheEvents'
import styles from './WorkspaceDataProvider.module.css'

type WorkspaceDataStatus = 'loading' | 'ready' | 'error'

type WorkspaceDataContextValue = {
  dataSource: WorkspaceDataSource
  status: WorkspaceDataStatus
  error: string | null
  revision: number
  refresh: () => Promise<void>
  resetServerSession: () => void
}

const WorkspaceDataContext = createContext<WorkspaceDataContextValue | null>(null)

let pendingServerHydration: Promise<void> | null = null

function hydrateServerWorkspace() {
  if (!pendingServerHydration) {
    pendingServerHydration = loadServerWorkspace()
      .then(() => undefined)
      .finally(() => {
        pendingServerHydration = null
      })
  }

  return pendingServerHydration
}

export function WorkspaceDataProvider({ children }: PropsWithChildren) {
  const configuration = getWorkspaceRuntimeConfiguration()
  const [status, setStatus] = useState<WorkspaceDataStatus>(() => {
    if (configuration.configurationError) {
      return 'error'
    }

    return configuration.dataSource === 'server' && hasServerSession() ? 'loading' : 'ready'
  })
  const [error, setError] = useState<string | null>(configuration.configurationError)
  const [revision, setRevision] = useState(0)

  const refresh = useCallback(async () => {
    if (configuration.configurationError) {
      setError(configuration.configurationError)
      setStatus('error')
      return
    }

    if (configuration.dataSource === 'mock' || !hasServerSession()) {
      setError(null)
      setStatus('ready')
      return
    }

    setError(null)
    setStatus('loading')

    try {
      await hydrateServerWorkspace()
      setStatus('ready')
    } catch (loadError) {
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : '서버 워크스페이스를 불러오지 못했습니다.',
      )
      setStatus('error')
    }
  }, [configuration.configurationError, configuration.dataSource])

  const resetServerSession = useCallback(() => {
    signOutServerUser()
    setError(null)
    setStatus('ready')
  }, [])

  useEffect(() => {
    const unsubscribeFromUpdates = subscribeToWorkspaceCache(() =>
      setRevision((current) => current + 1),
    )
    const unsubscribeFromRefreshFailures = subscribeToWorkspaceCacheRefreshFailure(
      (message) => {
        setError(message)
        setStatus('error')
      },
    )

    return () => {
      unsubscribeFromUpdates()
      unsubscribeFromRefreshFailures()
    }
  }, [])

  useEffect(() => {
    if (
      configuration.configurationError ||
      configuration.dataSource !== 'server' ||
      !hasServerSession()
    ) {
      return
    }

    void refresh()
  }, [configuration.configurationError, configuration.dataSource, refresh])

  const value = useMemo<WorkspaceDataContextValue>(
    () => ({
      dataSource: configuration.dataSource,
      status,
      error,
      revision,
      refresh,
      resetServerSession,
    }),
    [configuration.dataSource, error, refresh, resetServerSession, revision, status],
  )

  return <WorkspaceDataContext.Provider value={value}>{children}</WorkspaceDataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceData() {
  const context = useContext(WorkspaceDataContext)

  if (!context) {
    throw new Error('useWorkspaceData must be used within WorkspaceDataProvider')
  }

  return context
}

export function WorkspaceDataGate({ children }: PropsWithChildren) {
  const { dataSource, status, error, refresh, resetServerSession } = useWorkspaceData()

  if (status === 'ready') {
    return children
  }

  if (status === 'loading') {
    return (
      <main className={styles.statePage} aria-busy="true" aria-live="polite">
        <div className={styles.stateCard}>
          <span className={styles.spinner} aria-hidden="true" />
          <h1>서버 데이터를 불러오는 중입니다.</h1>
          <p>인증 정보와 워크스페이스 컨텍스트를 확인하고 있습니다.</p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.statePage}>
      <div className={styles.stateCard} role="alert">
        <span className={styles.errorMark} aria-hidden="true">!</span>
        <h1>
          {dataSource === 'server'
            ? '서버 데이터에 연결하지 못했습니다.'
            : '워크스페이스 데이터 설정을 확인해 주세요.'}
        </h1>
        <p>{error ?? 'API 주소와 네트워크 상태를 확인해 주세요.'}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.primaryAction} onClick={() => void refresh()}>
            다시 시도
          </button>
          {dataSource === 'server' ? (
            <button type="button" className={styles.secondaryAction} onClick={resetServerSession}>
              로그인 화면으로 돌아가기
            </button>
          ) : null}
        </div>
      </div>
    </main>
  )
}
