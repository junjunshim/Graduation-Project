// 내 GitHub 자격증명(PAT) 설정 팝업.
// 자격증명은 사용자 전역 1개(§6-4)라 워크스페이스가 아니라 사용자 메뉴에서 관리한다.
// API 클라이언트는 GitHub 관련 호출을 한 모듈에 모아 둔 곳을 그대로 쓴다(알림 기능도 같은 방식으로 가져다 쓴다).
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  disconnectCredential,
  fetchCredentialStatus,
  registerCredential,
  type GithubCredentialStatus,
} from '../../workspace/data/githubService'
import styles from './GitHubCredentialDialog.module.css'

type GitHubCredentialDialogProps = {
  isOpen: boolean
  onClose: () => void
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export function GitHubCredentialDialog({ isOpen, onClose }: GitHubCredentialDialogProps) {
  const [credential, setCredential] = useState<GithubCredentialStatus | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [patInput, setPatInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 닫힘 → 열림 전환에서만 다시 읽는다. 부모가 리렌더돼도 입력 중인 값을 지우지 않는다.
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false
      return
    }

    if (wasOpenRef.current) {
      return
    }
    wasOpenRef.current = true

    setPatInput('')
    setError(null)
    setIsLoading(true)

    let isSubscribed = true

    void fetchCredentialStatus()
      .then((status) => {
        if (isSubscribed) {
          setCredential(status)
        }
      })
      .catch((requestError) => {
        if (isSubscribed) {
          setCredential(null)
          setError(errorMessage(requestError, 'GitHub 자격증명 상태를 불러오지 못했습니다.'))
        }
      })
      .finally(() => {
        if (isSubscribed) {
          setIsLoading(false)
        }
      })

    return () => {
      isSubscribed = false
    }
  }, [isOpen])

  // ESC 로 닫기. 저장 중에는 닫지 않는다(중복 요청 방지).
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSaving) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSaving, onClose])

  const handleSave = async () => {
    const token = patInput.trim()

    if (!token) {
      setError('토큰을 입력해 주세요.')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const status = await registerCredential(token)
      setCredential(status)
      setPatInput('')
    } catch (requestError) {
      setError(errorMessage(requestError, 'GitHub 자격증명을 등록하지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleDisconnect = async () => {
    setIsSaving(true)
    setError(null)

    try {
      await disconnectCredential()
      setCredential({ has_credential: false })
    } catch (requestError) {
      setError(errorMessage(requestError, 'GitHub 자격증명 연결을 해제하지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) {
    return null
  }

  const hasCredential = credential?.has_credential === true

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label="GitHub 자격증명"
      onClick={isSaving ? undefined : onClose}
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="lock" size={20} className={styles.headerIcon} />
            <div className={styles.titleText}>
              <h2 className={styles.title}>GitHub 자격증명</h2>
              <span className={styles.subtitle}>커밋을 원격에 push 할 때 쓸 내 계정 토큰입니다.</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSaving}
            aria-label="닫기"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.body}>
          {isLoading ? <p className={styles.hint}>자격증명 상태를 불러오는 중…</p> : null}

          {!isLoading && hasCredential ? (
            <>
              <div className={styles.statusCard}>
                <span className={styles.statusMain}>
                  <Icon name="checkCircle" size={16} className={styles.statusOk} />
                  <span className={styles.statusLogin}>{credential?.github_login || '연결됨'}</span>
                </span>
                <Button variant="secondary" onClick={() => void handleDisconnect()} disabled={isSaving}>
                  해제
                </Button>
              </div>
              <p className={styles.statusMeta}>
                {credential?.scopes ? `스코프: ${credential.scopes}` : '스코프 정보 없음'}
                {credential?.expires_at ? ` · 만료: ${credential.expires_at}` : ''}
              </p>
            </>
          ) : null}

          {!isLoading && !hasCredential ? (
            <>
              <p className={styles.hint}>
                PAT(personal access token)를 등록하면 비공개 저장소 clone 과 push 가 가능합니다. &quot;repo&quot;
                스코프가 필요합니다. 토큰은 암호화해 서버에만 저장하고 화면에 다시 보여주지 않습니다.
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
              <div className={styles.footer}>
                <Button variant="primary" onClick={() => void handleSave()} disabled={isSaving}>
                  {isSaving ? '등록 중…' : '등록'}
                </Button>
              </div>
            </>
          ) : null}

          {error ? <p className={styles.errorText}>{error}</p> : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}