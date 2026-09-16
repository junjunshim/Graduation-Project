import { useCallback, useEffect, useState } from 'react'
import type { DashboardContext } from '../model/dashboardTypes'
import { loadDashboardContext } from './dashboardService'

type DashboardContextStatus = 'loading' | 'ready' | 'error'

type DashboardContextState = {
  status: DashboardContextStatus
  context: DashboardContext | null
  error: string | null
  reload: () => void
}

const LOAD_ERROR_MESSAGE = '대시보드 정보를 불러오지 못했습니다.'

export function useDashboardContext(): DashboardContextState {
  const [status, setStatus] = useState<DashboardContextStatus>('loading')
  const [context, setContext] = useState<DashboardContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCancelled = false

    setStatus('loading')
    setError(null)

    loadDashboardContext()
      .then((nextContext) => {
        if (isCancelled) return
        setContext(nextContext)
        setStatus('ready')
      })
      .catch((loadError: unknown) => {
        if (isCancelled) return
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