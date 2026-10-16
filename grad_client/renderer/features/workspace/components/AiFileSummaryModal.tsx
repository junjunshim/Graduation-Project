import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { MarkdownViewer } from './MarkdownViewer'
import { summarizeFileWithAi, type AiSummaryResult } from '../data/aiSummaryService'
import styles from './AiFileSummaryModal.module.css'

export type AiFileSummaryModalProps = {
  isOpen: boolean
  onClose: () => void
  fileName: string
  content: string
  sourceLabel?: string
  onOpenAiSettings?: () => void
}

function parseAiError(rawError: string | undefined): { title: string; subtitle: string; details?: string } {
  if (!rawError) {
    return {
      title: '알 수 없는 오류가 발생했습니다.',
      subtitle: '네트워크 연결을 확인하거나 잠시 후 다시 시도해 주세요.',
    }
  }

  const lower = rawError.toLowerCase()

  // 1. Quota Exceeded (할당량 초과)
  if (lower.includes('quota exceeded') || lower.includes('resource_exhausted') || lower.includes('429')) {
    const retryMatch = rawError.match(/retry in\s+([0-9a-z.]+)/i)
    const retryText = retryMatch ? ` (대기 권장 시간: ${retryMatch[1]})` : ''
    return {
      title: 'API 호출 할당량(Quota) 초과',
      subtitle: `현재 사용 중인 API 키의 무료 사용량 한도에 도달했습니다${retryText}. 잠시 후 다시 시도하거나, 상위 플랜 또는 다른 모델 단계를 선택해 주세요.`,
      details: rawError,
    }
  }

  // 2. API Key Invalid (인증 실패)
  if (lower.includes('api_key_invalid') || lower.includes('invalid api key') || lower.includes('401') || lower.includes('unauthenticated')) {
    return {
      title: 'API 키 인증 실패',
      subtitle: '등록된 API 키가 유효하지 않거나 만료되었습니다. [AI API 키 설정]에서 올바른 키를 다시 등록해 주세요.',
      details: rawError,
    }
  }

  // 3. Timeout (시간 초과)
  if (lower.includes('시간 초과') || lower.includes('timeout') || lower.includes('aborted')) {
    return {
      title: '요청 시간 초과 (Timeout)',
      subtitle: 'AI 서버의 응답이 지연되고 있습니다. 파일 크기가 너무 크거나 네트워크 연결이 불안정할 수 있습니다.',
      details: rawError,
    }
  }

  // 4. Model not found / Unsupported
  if (lower.includes('not found') || lower.includes('is not enabled') || lower.includes('unsupported')) {
    return {
      title: '모델 호출 불가 또는 미지원',
      subtitle: '선택된 모델을 현재 계정 환경에서 호출할 수 없습니다. 모델 성능 단계를 조정하거나 다른 모델을 시도해 주세요.',
      details: rawError,
    }
  }

  // 기본
  return {
    title: 'AI 요약 요청 실패',
    subtitle: 'AI 서비스 호출 중 오류가 발생했습니다.',
    details: rawError,
  }
}

export function AiFileSummaryModal({
  isOpen,
  onClose,
  fileName,
  content,
  sourceLabel = '워크스페이스 파일',
  onOpenAiSettings,
}: AiFileSummaryModalProps) {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stepMessage, setStepMessage] = useState('파일 데이터 준비 중...')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [result, setResult] = useState<AiSummaryResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showErrorDetails, setShowErrorDetails] = useState(false)

  // 진행률 기본 증가 시뮬레이션 (콜백이 오면 콜백 값 우선)
  useEffect(() => {
    if (!loading) {
      setProgress(100)
      return
    }

    setProgress(15)
    setStepMessage('가용 AI 모델 확인 및 연결 중...')

    const t1 = setTimeout(() => {
      setProgress((prev) => Math.max(prev, 35))
      setStepMessage('파일 성격(코드/회의록/문서) 분석 및 프롬프트 최적화 중...')
    }, 500)

    const t4 = setInterval(() => {
      setProgress((prev) => (prev < 94 ? prev + 1 : prev))
    }, 400)

    return () => {
      clearTimeout(t1)
      clearInterval(t4)
    }
  }, [loading])

  const handleSummarize = async () => {
    if (!content.trim()) {
      setLoading(false)
      setResult({
        success: false,
        summary: '',
        providerName: '',
        modelName: '',
        error: '파일 내용이 비어 있어 요약할 수 없습니다.',
      })
      return
    }

    setLoading(true)
    setResult(null)
    setSelectedModel(null)
    try {
      const res = await summarizeFileWithAi({
        fileName,
        content,
        sourceLabel,
        onModelSelected: (model) => {
          setSelectedModel(model)
        },
        onProgress: (step, percent) => {
          setStepMessage(step)
          if (typeof percent === 'number') {
            setProgress(percent)
          }
        },
      })
      setResult(res)
    } catch (err) {
      setResult({
        success: false,
        summary: '',
        providerName: '',
        modelName: '',
        error: err instanceof Error ? err.message : '요약 요청 중 오류가 발생했습니다.',
      })
    } finally {
      setLoading(false)
    }
  }

  // 모달이 열릴 때 자동으로 1회 요약 요청
  useEffect(() => {
    if (isOpen && content) {
      void handleSummarize()
    } else if (!isOpen) {
      setResult(null)
      setLoading(false)
      setProgress(0)
      setSelectedModel(null)
      setCopied(false)
    }
  }, [isOpen, fileName, content])

  if (!isOpen || typeof document === 'undefined') return null

  const handleCopy = async () => {
    if (!result?.summary) return
    try {
      await navigator.clipboard.writeText(result.summary)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 모달 헤더 */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.aiBadge}>
              <Icon name="sparkles" size={18} />
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.modalTitleRow}>
                <h3 className={styles.modalTitle}>AI 파일 분석 및 요약</h3>
                {result?.providerName ? (
                  <span className={styles.providerBadge}>
                    {result.providerName} ({result.modelName || selectedModel || ''})
                  </span>
                ) : selectedModel ? (
                  <span className={styles.providerBadge}>
                    {selectedModel}
                  </span>
                ) : null}
              </div>
              <p className={styles.targetFileName} title={fileName}>
                {fileName} · {sourceLabel}
              </p>
            </div>
          </div>

          <div className={styles.headerRight}>
            {result?.success ? (
              <>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleCopy}
                  title="요약 결과 복사"
                >
                  <Icon name="checkSquare" size={15} />
                  <span>{copied ? '복사됨!' : '결과 복사'}</span>
                </button>
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={handleSummarize}
                  disabled={loading}
                  title="다시 요약 요청"
                >
                  <Icon name="rotateCcw" size={14} />
                  <span>재요약</span>
                </button>
              </>
            ) : null}

            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="닫기"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>

        {/* 모달 본문 */}
        <div className={styles.body}>
          {loading ? (
            <div className={styles.loadingContainer}>
              <div className={styles.spinner} />
              <p className={styles.loadingTitle}>파일 내용을 분석하고 요약 중입니다...</p>

              <div className={styles.progressWrapper}>
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                </div>
                <div className={styles.progressMeta}>
                  <span>{stepMessage}</span>
                  <span>{progress}%</span>
                </div>
              </div>

              {selectedModel ? (
                <div className={styles.selectedModelBanner}>
                  <Icon name="sparkles" size={14} />
                  <span>
                    선택된 모델: <strong className={styles.modelBadge}>{selectedModel}</strong>
                  </span>
                </div>
              ) : null}

              <p className={styles.loadingSub}>
                파일의 성격(코드, 회의록, 데이터 등)에 맞춰 맞춤형 보고서를 작성하고 있습니다.
              </p>
            </div>
          ) : result && !result.success ? (() => {
            const parsed = parseAiError(result.error)
            return (
              <div className={styles.errorContainer}>
                <div className={styles.errorIcon}>
                  <Icon name="alertTriangle" size={34} />
                </div>
                <h4 className={styles.errorHeadline}>{parsed.title}</h4>
                <p className={styles.errorSubtitle}>{parsed.subtitle}</p>

                {parsed.details ? (
                  <div className={styles.errorDetailsBox}>
                    <button
                      type="button"
                      className={styles.errorDetailsToggle}
                      onClick={() => setShowErrorDetails((prev) => !prev)}
                    >
                      <Icon name="helpCircle" size={13} />
                      <span>{showErrorDetails ? '상세 기술 오류 접기' : '상세 기술 오류 확인하기'}</span>
                    </button>
                    {showErrorDetails ? (
                      <pre className={styles.errorDetailsPre}>{parsed.details}</pre>
                    ) : null}
                  </div>
                ) : null}

                <div className={styles.errorActions}>
                  {onOpenAiSettings ? (
                    <button
                      type="button"
                      className={styles.settingsBtn}
                      onClick={() => {
                        onClose()
                        onOpenAiSettings()
                      }}
                    >
                      <Icon name="sparkles" size={14} />
                      <span>AI 설정 (모델 단계 / 키 변경)</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.retryBtn}
                    onClick={handleSummarize}
                  >
                    <Icon name="rotateCcw" size={14} />
                    <span>다시 시도</span>
                  </button>
                </div>
              </div>
            )
          })() : result?.summary ? (
            <div className={styles.resultCard}>
              <MarkdownViewer content={result.summary} />
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}
