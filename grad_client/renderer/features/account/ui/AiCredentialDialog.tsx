// 사용자 개인 AI API 키 설정 다이얼로그 모달
// OpenAI, Google Gemini, Anthropic Claude 등의 개인 API 키를 로컬에 등록/수정/삭제한다.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  AI_PROVIDERS,
  getStoredAiApiKeys,
  maskApiKey,
  removeStoredAiApiKey,
  saveStoredAiApiKey,
  type AiApiKeyRecord,
  type AiProvider,
} from '../data/aiApiKeyService'
import styles from './AiCredentialDialog.module.css'

type AiCredentialDialogProps = {
  isOpen: boolean
  onClose: () => void
}

export function AiCredentialDialog({ isOpen, onClose }: AiCredentialDialogProps) {
  const [keys, setKeys] = useState<Record<AiProvider, AiApiKeyRecord | undefined>>(() => getStoredAiApiKeys())
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null)
  const [inputKey, setInputKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 다이얼로그 열릴 때마다 로컬 스토리지 최신값 반영
  useEffect(() => {
    if (isOpen) {
      setKeys(getStoredAiApiKeys())
      setEditingProvider(null)
      setInputKey('')
      setShowPassword(false)
      setError(null)
    }
  }, [isOpen])

  // ESC 키로 닫기
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleStartEdit = (provider: AiProvider) => {
    const existing = keys[provider]
    setEditingProvider(provider)
    setInputKey(existing ? existing.apiKey : '')
    setShowPassword(false)
    setError(null)
  }

  const handleCancelEdit = () => {
    setEditingProvider(null)
    setInputKey('')
    setError(null)
  }

  const handleSave = (provider: AiProvider) => {
    const trimmedKey = inputKey.trim()
    if (!trimmedKey) {
      setError('API Key를 입력해 주세요.')
      return
    }

    const providerMeta = AI_PROVIDERS.find((p) => p.id === provider)
    const newRecord: AiApiKeyRecord = {
      provider,
      name: providerMeta?.label || provider,
      apiKey: trimmedKey,
      updatedAt: new Date().toISOString(),
    }

    saveStoredAiApiKey(newRecord)
    setKeys(getStoredAiApiKeys())
    setEditingProvider(null)
    setInputKey('')
    setError(null)
  }

  const handleDelete = (provider: AiProvider) => {
    removeStoredAiApiKey(provider)
    setKeys(getStoredAiApiKeys())
    if (editingProvider === provider) {
      setEditingProvider(null)
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="AI API 키 설정"
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="sparkles" size={20} className={styles.headerIcon} />
            <div className={styles.titleText}>
              <h2 className={styles.title}>AI API 키 설정</h2>
              <span className={styles.subtitle}>업무 요약 및 문서 분석에 사용되는 개인 키 관리</span>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.hint}>
            등록된 API 키는 서버로 전송되지 않고 <strong>현재 사용자의 브라우저(로컬)에만 안전하게 보관</strong>됩니다.
            필요한 AI 제공자의 키를 등록해 두면 향후 AI 업무 요약/자동화 기능에서 바로 활용됩니다.
          </p>

          <div className={styles.providerList}>
            {AI_PROVIDERS.map((provider) => {
              const record = keys[provider.id]
              const isRegistered = Boolean(record?.apiKey)
              const isEditing = editingProvider === provider.id

              return (
                <div
                  key={provider.id}
                  className={[styles.providerCard, isRegistered ? styles.providerCardRegistered : ''].filter(Boolean).join(' ')}
                >
                  <div className={styles.cardHeader}>
                    <div className={styles.providerInfo}>
                      <span className={styles.providerName}>{provider.label}</span>
                      <span
                        className={[styles.statusBadge, isRegistered ? styles.statusRegistered : styles.statusNotSet].join(' ')}
                      >
                        {isRegistered ? '등록됨' : '미등록'}
                      </span>
                    </div>

                    {!isEditing && (
                      <div className={styles.cardActions}>
                        <Button
                          variant="secondary"
                          onClick={() => handleStartEdit(provider.id)}
                          aria-label={`${provider.label} ${isRegistered ? '수정' : '등록'}`}
                        >
                          {isRegistered ? '수정' : '키 등록'}
                        </Button>
                        {isRegistered && (
                          <Button
                            variant="icon"
                            onClick={() => handleDelete(provider.id)}
                            aria-label={`${provider.label} 삭제`}
                          >
                            <Icon name="trash" size={15} />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 등록된 상태에서 편집 중이 아닐 때 미리보기 */}
                  {isRegistered && !isEditing && record && (
                    <div className={styles.registeredView}>
                      <div className={styles.keyDisplay}>
                        <span className={styles.maskedKey}>{maskApiKey(record.apiKey)}</span>
                      </div>
                      <span className={styles.metaText}>
                        등록일: {new Date(record.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}

                  {/* 편집 폼 */}
                  {isEditing && (
                    <form
                      className={styles.editForm}
                      onSubmit={(e) => {
                        e.preventDefault()
                        handleSave(provider.id)
                      }}
                    >
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>API Key</span>
                        <div className={styles.inputGroup}>
                          <input
                            className={styles.input}
                            type={showPassword ? 'text' : 'password'}
                            value={inputKey}
                            onChange={(e) => setInputKey(e.target.value)}
                            placeholder={provider.placeholder}
                            autoFocus
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className={styles.toggleVisibilityBtn}
                            onClick={() => setShowPassword((prev) => !prev)}
                            aria-label={showPassword ? '키 가리기' : '키 보기'}
                          >
                            <Icon name={showPassword ? 'eyeOff' : 'eye'} size={15} />
                          </button>
                        </div>
                      </label>

                      {error && <p className={styles.errorText}>{error}</p>}

                      <div className={styles.formActions}>
                        <Button type="button" variant="secondary" onClick={handleCancelEdit}>
                          취소
                        </Button>
                        <Button type="submit" variant="primary">
                          저장
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
