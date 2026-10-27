import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { UserRecord } from '../../workspace/model/types'
import { WorkspaceSelectDropdown } from '../../workspace/components/WorkspaceSelectDropdown'
import type { WorkspaceChannelItem } from '../model/channelTypes'
import styles from './ChannelModals.module.css'

export type ManageableWorkspaceOption = {
  nodeId: number
  nodeName: string
  nodeType?: string
}

export type ChannelFormModalProps = {
  mode: 'create' | 'edit'
  isOpen: boolean
  manageableWorkspaces: ManageableWorkspaceOption[]
  initialNodeId?: number
  editingChannel?: WorkspaceChannelItem | null
  onClose: () => void
  onSubmit: (payload: {
    nodeId: number
    name: string
    description: string
  }) => Promise<void>
}

export function ChannelFormModal({
  mode,
  isOpen,
  manageableWorkspaces,
  initialNodeId,
  editingChannel,
  onClose,
  onSubmit,
}: ChannelFormModalProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<number>(
    initialNodeId ?? manageableWorkspaces[0]?.nodeId ?? 0,
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setErrorMessage(null)

    if (mode === 'edit' && editingChannel) {
      setSelectedNodeId(editingChannel.ownerNodeId)
      setName(editingChannel.name)
      setDescription(editingChannel.description)
    } else {
      setSelectedNodeId(initialNodeId ?? manageableWorkspaces[0]?.nodeId ?? 0)
      setName('')
      setDescription('')
    }
  }, [isOpen, mode, editingChannel, initialNodeId, manageableWorkspaces])

  if (!isOpen) {
    return null
  }

  const sanitizedName = name.replace(/^#+/, '').trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sanitizedName) {
      setErrorMessage('채널 이름을 입력해 주세요.')
      return
    }
    if (mode === 'create' && !selectedNodeId) {
      setErrorMessage('채널을 생성할 워크스페이스를 선택해 주세요.')
      return
    }

    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      await onSubmit({
        nodeId: selectedNodeId,
        name: sanitizedName,
        description: description.trim(),
      })
      onClose()
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : mode === 'create'
            ? '채널을 생성하지 못했습니다.'
            : '채널을 수정하지 못했습니다.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label={mode === 'create' ? '새 채널 만들기' : '채널 수정'}>
      <div className={styles.modalCard}>
        <header className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.modalTitle}>
              {mode === 'create' ? '새 채널 만들기' : '채널 정보 수정'}
            </h2>
            <p className={styles.modalSubtitle}>
              {mode === 'create'
                ? '워크스페이스 팀원들이 주제별로 소통할 수 있는 새 토픽 채널을 개설합니다.'
                : '채널 이름과 설명을 업데이트합니다.'}
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="닫기"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <form className={styles.form} onSubmit={(e) => void handleSubmit(e)}>
          {mode === 'create' ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>워크스페이스</span>
              <WorkspaceSelectDropdown
                options={manageableWorkspaces}
                value={selectedNodeId}
                disabled={isSubmitting}
                placeholder="워크스페이스를 선택하세요"
                ariaLabel="채널을 생성할 워크스페이스 선택"
                onChange={(nodeId) => setSelectedNodeId(nodeId)}
              />
            </div>
          ) : editingChannel ? (
            <div className={styles.field}>
              <span className={styles.fieldLabel}>소속 워크스페이스</span>
              <div className={styles.readonlyBox}>{editingChannel.ownerNodeName}</div>
            </div>
          ) : null}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>채널 이름</span>
            <div className={styles.prefixInputWrap}>
              <span className={styles.prefixSymbol} aria-hidden="true">
                #
              </span>
              <input
                type="text"
                className={styles.prefixInput}
                placeholder="예: 공지사항, 프론트엔드, 주간회의"
                value={name}
                disabled={isSubmitting}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <span className={styles.fieldHelp}>
              채널 이름 앞에는 자동으로 # 기호가 표시됩니다.
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>채널 설명 (선택)</span>
            <textarea
              rows={3}
              className={styles.textarea}
              placeholder="이 채널에서 어떤 주제를 다루는지 설명해 주세요."
              value={description}
              disabled={isSubmitting}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText} role="alert">
              {errorMessage}
            </p>
          ) : null}

          <footer className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              disabled={isSubmitting}
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting || !sanitizedName}
            >
              {isSubmitting
                ? '처리 중...'
                : mode === 'create'
                  ? '채널 만들기'
                  : '변경사항 저장'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}

export type NewDmModalProps = {
  isOpen: boolean
  currentUserEmail: string
  knownUsers: UserRecord[]
  onClose: () => void
  onStartDm: (targetEmail: string) => Promise<void>
}

export function NewDmModal({
  isOpen,
  currentUserEmail,
  knownUsers,
  onClose,
  onStartDm,
}: NewDmModalProps) {
  const [emailInput, setEmailInput] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setEmailInput('')
    setErrorMessage(null)
  }, [isOpen])

  const colleagueSuggestions = useMemo(() => {
    const normCurrent = currentUserEmail.trim().toLowerCase()
    const query = emailInput.trim().toLowerCase()

    const uniqueByEmail = new Map<string, UserRecord>()
    knownUsers.forEach((u) => {
      const email = (u.email || u.userId).trim().toLowerCase()
      if (!email || !email.includes('@') || email === normCurrent) return
      if (!uniqueByEmail.has(email)) {
        uniqueByEmail.set(email, u)
      }
    })

    const list = Array.from(uniqueByEmail.values())
    if (!query) return list

    return list.filter(
      (u) =>
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query),
    )
  }, [knownUsers, currentUserEmail, emailInput])

  if (!isOpen) {
    return null
  }

  async function triggerStartDm(targetEmail: string) {
    const trimmed = targetEmail.trim().toLowerCase()
    if (!trimmed) {
      setErrorMessage('대화할 상대방의 이메일 주소를 입력해 주세요.')
      return
    }
    if (trimmed === currentUserEmail.trim().toLowerCase()) {
      setErrorMessage('본인 이메일로는 1:1 대화를 시작할 수 없습니다.')
      return
    }

    setErrorMessage(null)
    setIsSubmitting(true)
    try {
      await onStartDm(trimmed)
      onClose()
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message
          ? error.message
          : '1:1 대화방을 열지 못했습니다. 가입된 이메일인지 확인해 주세요.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void triggerStartDm(emailInput)
  }

  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="이메일로 1:1 대화 시작">
      <div className={styles.modalCard}>
        <header className={styles.modalHeader}>
          <div className={styles.headerTitleGroup}>
            <h2 className={styles.modalTitle}>1:1 다이렉트 메시지 시작</h2>
            <p className={styles.modalSubtitle}>
              같은 워크스페이스에 속해 있지 않더라도 가입된 이메일 주소만 알면 누구와든 1:1 대화를 시작할 수 있습니다.
            </p>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            aria-label="닫기"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <form className={styles.form} onSubmit={handleFormSubmit}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>상대방 이메일 주소</span>
            <input
              type="email"
              className={styles.input}
              placeholder="colleague@example.com"
              value={emailInput}
              disabled={isSubmitting}
              autoFocus
              onChange={(e) => setEmailInput(e.target.value)}
            />
          </label>

          {colleagueSuggestions.length > 0 ? (
            <div className={styles.suggestionSection}>
              <span className={styles.suggestionHeading}>함께 일하는 동료 추천</span>
              <ul className={styles.suggestionList}>
                {colleagueSuggestions.map((user) => (
                  <li key={user.email || user.userId}>
                    <button
                      type="button"
                      className={styles.suggestionItem}
                      disabled={isSubmitting}
                      onClick={() => void triggerStartDm(user.email)}
                    >
                      <UserAvatar
                        name={user.name}
                        userId={user.userId || user.email}
                        size="small"
                      />
                      <div className={styles.suggestionText}>
                        <span className={styles.suggestionName}>{user.name}</span>
                        <span className={styles.suggestionEmail}>{user.email}</span>
                      </div>
                      <span className={styles.suggestionAction}>대화하기 →</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {errorMessage ? (
            <p className={styles.errorText} role="alert">
              {errorMessage}
            </p>
          ) : null}

          <footer className={styles.modalFooter}>
            <button
              type="button"
              className={styles.cancelBtn}
              disabled={isSubmitting}
              onClick={onClose}
            >
              취소
            </button>
            <button
              type="submit"
              className={styles.submitBtn}
              disabled={isSubmitting || !emailInput.trim()}
            >
              {isSubmitting ? '연결 중...' : '대화 시작'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
