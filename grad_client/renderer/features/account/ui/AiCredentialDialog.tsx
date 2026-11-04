// 사용자 개인 AI API 키 설정 다이얼로그 모달
// OpenAI, Google Gemini, Anthropic Claude 등의 개인 API 키를 로컬에 등록/수정/삭제한다.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  AI_PERFORMANCE_LEVELS,
  AI_PROVIDERS,
  getStoredAiApiKeys,
  getStoredAiPerformanceLevel,
  getStoredAiProviderOrder,
  maskApiKey,
  removeStoredAiApiKey,
  saveStoredAiApiKey,
  saveStoredAiPerformanceLevel,
  saveStoredAiProviderOrder,
  type AiApiKeyRecord,
  type AiPerformanceLevel,
  type AiProvider,
} from '../data/aiApiKeyService'
import styles from './AiCredentialDialog.module.css'

type AiCredentialDialogProps = {
  isOpen: boolean
  onClose: () => void
}

export function AiCredentialDialog({ isOpen, onClose }: AiCredentialDialogProps) {
  const [keys, setKeys] = useState<Record<AiProvider, AiApiKeyRecord | undefined>>(() => getStoredAiApiKeys())
  const [providerOrder, setProviderOrder] = useState<AiProvider[]>(() => getStoredAiProviderOrder())
  const [perfLevel, setPerfLevel] = useState<AiPerformanceLevel>(() => getStoredAiPerformanceLevel())
  const [editingProvider, setEditingProvider] = useState<AiProvider | null>(null)
  const [inputKey, setInputKey] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 다이얼로그 열릴 때마다 로컬 스토리지 최신값 반영
  useEffect(() => {
    if (isOpen) {
      setKeys(getStoredAiApiKeys())
      setProviderOrder(getStoredAiProviderOrder())
      setPerfLevel(getStoredAiPerformanceLevel())
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

  const handleMoveOrder = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= providerOrder.length) return

    const nextOrder = [...providerOrder]
    const temp = nextOrder[index]
    nextOrder[index] = nextOrder[targetIndex]
    nextOrder[targetIndex] = temp

    setProviderOrder(nextOrder)
    saveStoredAiProviderOrder(nextOrder)
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
            목록의 <strong>위쪽 순서(1순위)부터 우선적으로 자동 사용</strong>되며, 우측 화살표로 우선순위를 변경할 수 있습니다.
          </p>

          {/* 5단계 AI 모델 성능/성향 설정 바 */}
          <div className={styles.levelSection}>
            <div className={styles.levelHeader}>
              <span className={styles.levelTitle}>
                <Icon name="gear" size={14} />
                <span>AI 모델 성능 등급 (5단계)</span>
              </span>
              <span className={styles.levelCurrentLabel}>
                {AI_PERFORMANCE_LEVELS.find((l) => l.level === perfLevel)?.title} ({perfLevel}단계)
              </span>
            </div>

            <div className={styles.levelCards} role="radiogroup" aria-label="AI 모델 성능 등급">
              {AI_PERFORMANCE_LEVELS.map((item) => {
                const isActive = perfLevel === item.level
                return (
                  <button
                    key={item.level}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    className={[styles.levelCard, isActive ? styles.levelCardActive : ''].join(' ')}
                    onClick={() => {
                      setPerfLevel(item.level)
                      saveStoredAiPerformanceLevel(item.level)
                    }}
                    title={`${item.title}: ${item.subtitle}`}
                  >
                    <span className={styles.levelNum}>{item.level}단계</span>
                    <span className={styles.levelCardTitle}>{item.title}</span>
                  </button>
                )
              })}
            </div>

            <p className={styles.levelDesc}>
              {AI_PERFORMANCE_LEVELS.find((l) => l.level === perfLevel)?.subtitle}
            </p>
          </div>

          <div className={styles.providerList}>
            {providerOrder.map((providerId, index) => {
              const provider = AI_PROVIDERS.find((p) => p.id === providerId)
              if (!provider) return null

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
                      <span className={[styles.orderBadge, isRegistered ? styles.orderBadgeActive : ''].join(' ')} title={`우선순위 ${index + 1}순위`}>
                        {index + 1}
                      </span>
                      <span className={styles.providerName}>{provider.label}</span>
                      <span
                        className={[styles.statusBadge, isRegistered ? styles.statusRegistered : styles.statusNotSet].join(' ')}
                      >
                        {isRegistered ? '등록됨' : '미등록'}
                      </span>
                    </div>

                    {!isEditing && (
                      <div className={styles.cardActions}>
                        <div className={styles.orderControls}>
                          <button
                            type="button"
                            className={styles.orderBtn}
                            disabled={index === 0}
                            title="우선순위 올리기"
                            onClick={() => handleMoveOrder(index, 'up')}
                            aria-label={`${provider.label} 우선순위 올리기`}
                          >
                            <Icon name="chevronUp" size={14} />
                          </button>
                          <button
                            type="button"
                            className={styles.orderBtn}
                            disabled={index === providerOrder.length - 1}
                            title="우선순위 내리기"
                            onClick={() => handleMoveOrder(index, 'down')}
                            aria-label={`${provider.label} 우선순위 내리기`}
                          >
                            <Icon name="chevronDown" size={14} />
                          </button>
                        </div>
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
