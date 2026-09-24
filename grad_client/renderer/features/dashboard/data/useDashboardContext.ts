import { useCallback, useEffect, useState } from 'react'
import type { DashboardContext } from '../model/dashboardTypes'
import { loadDashboardContext, readCachedDashboardContext } from './dashboardService'

type DashboardContextStatus = 'loading' | 'ready' | 'error'

type DashboardContextState = {
  status: DashboardContextStatus
  context: DashboardContext | null
  error: string | null
  reload: () => void
}

const LOAD_ERROR_MESSAGE = '대시보드 정보를 불러오지 못했습니다.'

export function useDashboardContext(): DashboardContextState {
  // 재진입할 때는 로딩 화면 대신 캐시된 대시보드를 먼저 그린다.
  const [context, setContext] = useState<DashboardContext | null>(() => readCachedDashboardContext())
  const [status, setStatus] = useState<DashboardContextStatus>(() =>
    readCachedDashboardContext() ? 'ready' : 'loading',
  )
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCancelled = false
    const cachedContext = readCachedDashboardContext()

    // 캐시가 있으면 화면은 그대로 두고 최신 데이터로만 조용히 갱신한다.
    if (cachedContext) {
      setContext(cachedContext)
      setStatus('ready')
    } else {
      setStatus('loading')
    }
    setError(null)

    loadDashboardContext()
      .then((nextContext) => {
        if (isCancelled) return
        setContext(nextContext)
        setStatus('ready')
        setError(null)
      })
      .catch((loadError: unknown) => {
        if (isCancelled) return
        // 갱신에 실패해도 보여줄 캐시가 있으면 기존 화면을 유지한다.
        if (readCachedDashboardContext()) return
        setError(loadError instanceof Error && loadError.message ? loadError.message : LOAD_ERROR_MESSAGE)
        setStatus('error')
      })

    return () => {
      isCancelled = true
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  return { status, context, error, reload }
}