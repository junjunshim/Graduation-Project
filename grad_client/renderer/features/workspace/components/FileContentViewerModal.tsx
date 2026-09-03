import { useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './FileContentViewerModal.module.css'

export type FileContentViewerProps = {
  isOpen: boolean
  onClose: () => void
  fileName: string
  content: string
  fileSize?: number
  lastModified?: string
  fromCache?: boolean
  sourceLabel?: string
  isLoading?: boolean
  error?: string | null
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes === 0) return ''
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function FileContentViewerModal({
  isOpen,
  onClose,
  fileName,
  content,
  fileSize,
  lastModified,
  fromCache,
  sourceLabel = '워크스페이스 파일',
  isLoading,
  error,
}: FileContentViewerProps) {
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview')
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const lines = content.split('\n')
  const ext = fileName.split('.').pop()?.toUpperCase() ?? 'FILE'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 모달 상단 헤더 */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.fileTitleBlock}>
              <Icon name="fileText" size={20} className={styles.fileIcon} />
              <div className={styles.fileTitleInfo}>
                <div className={styles.fileTitleRow}>
                  <h3 className={styles.fileName}>{fileName}</h3>
                  <span className={styles.extBadge}>{ext}</span>
                  {fromCache ? <span className={styles.cacheBadge}>캐시됨 (304)</span> : null}
                </div>
                <div className={styles.fileMetaRow}>
                  <span>{sourceLabel}</span>
                  {fileSize ? <span>· {formatFileSize(fileSize)}</span> : null}
                  <span>· {lines.length} lines</span>
                  {lastModified ? <span>· {new Date(lastModified).toLocaleDateString()}</span> : null}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.headerRight}>
            {/* GitHub 스타일 Preview / Raw 토글 버튼 */}
            <div className={styles.viewToggleGroup}>
              <button
                type="button"
                className={[styles.viewToggleBtn, viewMode === 'preview' ? styles.viewToggleBtnActive : ''].join(' ')}
                onClick={() => setViewMode('preview')}
              >
                <Icon name="eye" size={15} />
                Preview
              </button>
              <button
                type="button"
                className={[styles.viewToggleBtn, viewMode === 'raw' ? styles.viewToggleBtnActive : ''].join(' ')}
                onClick={() => setViewMode('raw')}
              >
                <Icon name="page" size={15} />
                Raw
              </button>
            </div>

            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleCopy}
              title="내용 복사"
            >
              <Icon name="checkSquare" size={15} />
              <span>{copied ? '복사됨!' : '복사'}</span>
            </button>

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

        {/* 본문 뷰어 */}
        <div className={styles.body}>
          {isLoading ? (
            <div className={styles.statusState}>
              <p>파일 내용을 불러오는 중입니다...</p>
            </div>
          ) : error ? (
            <div className={styles.errorState}>
              <Icon name="alertTriangle" size={28} />
              <p>{error}</p>
            </div>
          ) : viewMode === 'raw' ? (
            /* Raw 뷰 (줄 번호 + 원시 텍스트) */
            <div className={styles.rawContainer}>
              <table className={styles.rawTable}>
                <tbody>
                  {lines.map((line, idx) => (
                    <tr key={idx} className={styles.rawRow}>
                      <td className={styles.lineNum}>{idx + 1}</td>
                      <td className={styles.lineCode}>
                        <code>{line || ' '}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Preview 포매팅 뷰 */
            <div className={styles.previewContainer}>
              <pre className={styles.previewText}>{content}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
