import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './ConfirmDeleteModal.module.css'

export type ConfirmRestoreModalProps = {
  isOpen: boolean
  title: string
  itemName: string
  itemTypeLabel?: string
  attachedFiles?: Array<{ id: number; name: string; size?: number; workItemTitle?: string }>
  childWorkItems?: Array<{ id: string; title: string }>
  childCount?: number
  onClose: () => void
  onConfirm: (cascade: boolean) => Promise<void> | void
}

function formatFileSize(bytes?: number) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function ConfirmRestoreModal({
  isOpen,
  title,
  itemName,
  itemTypeLabel = '업무',
  attachedFiles = [],
  childWorkItems = [],
  childCount = 0,
  onClose,
  onConfirm,
}: ConfirmRestoreModalProps) {
  const [isRestoring, setIsRestoring] = useState(false)
  const [cascade, setCascade] = useState(true)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setCascade(true)
    confirmBtnRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  const hasChildrenOrFiles = childWorkItems.length > 0 || childCount > 0 || attachedFiles.length > 0

  const handleConfirmClick = async () => {
    setIsRestoring(true)
    try {
      await onConfirm(cascade)
    } finally {
      setIsRestoring(false)
      onClose()
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.iconWrap} style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#2563eb' }}>
            <Icon name="restore" size={20} />
          </div>
          <h3 className={styles.title}>{title}</h3>
        </div>

        <div className={styles.body}>
          <p>
            정말로 <span className={styles.targetName}>{itemName}</span> {itemTypeLabel}을(를) 복구하시겠습니까?
          </p>

          {childWorkItems.length > 0 && (
            <div className={styles.attachedFilesWarning} style={{ borderColor: 'rgba(37, 99, 235, 0.3)', background: 'rgba(37, 99, 235, 0.05)' }}>
              <div className={styles.attachedFilesWarningHeader} style={{ color: '#2563eb' }}>
                <Icon name="helpCircle" size={14} />
                <span>함께 일괄 복구되는 하위 업무 ({childWorkItems.length}개):</span>
              </div>
              <ul className={styles.attachedFilesList}>
                {childWorkItems.map((c) => (
                  <li key={c.id} className={styles.attachedFileItem}>
                    <Icon name="chevronRight" size={13} className={styles.attachedFileIcon} />
                    <span className={styles.attachedFileName} title={c.title}>
                      {c.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div className={styles.attachedFilesWarning} style={{ borderColor: 'rgba(37, 99, 235, 0.3)', background: 'rgba(37, 99, 235, 0.05)' }}>
              <div className={styles.attachedFilesWarningHeader} style={{ color: '#2563eb' }}>
                <Icon name="helpCircle" size={14} />
                <span>함께 일괄 복구되는 첨부파일 ({attachedFiles.length}개):</span>
              </div>
              <ul className={styles.attachedFilesList}>
                {attachedFiles.map((f) => (
                  <li key={f.id} className={styles.attachedFileItem}>
                    <Icon name="fileText" size={13} className={styles.attachedFileIcon} />
                    {f.workItemTitle && f.workItemTitle !== itemName ? (
                      <span className={styles.attachedFileTaskTag} title={f.workItemTitle}>
                        [{f.workItemTitle}]
                      </span>
                    ) : null}
                    <span className={styles.attachedFileName} title={f.name}>
                      {f.name}
                    </span>
                    {f.size ? <span className={styles.attachedFileSize}>({formatFileSize(f.size)})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {childWorkItems.length === 0 && childCount > 0 && (
            <div className={styles.childCountWarning} style={{ color: '#2563eb' }}>
              <Icon name="helpCircle" size={14} />
              <span>하위 업무 {childCount}개도 함께 복구됩니다.</span>
            </div>
          )}

          {hasChildrenOrFiles && (
            <div className={styles.restoreOptionsCard}>
              <div className={styles.restoreOptionsTitle}>복구 범위 선택</div>
              <label className={styles.restoreOptionLabel}>
                <input
                  type="radio"
                  name="restoreCascade"
                  className={styles.restoreOptionRadio}
                  checked={cascade}
                  onChange={() => setCascade(true)}
                />
                <div className={styles.restoreOptionText}>
                  <span className={styles.restoreOptionPrimary}>하위 업무 및 첨부파일 함께 복구 (권장)</span>
                  <span className={styles.restoreOptionDesc}>
                    연관된 모든 하위 업무와 파일이 온전하게 일괄 복원됩니다.
                  </span>
                </div>
              </label>
              <label className={styles.restoreOptionLabel}>
                <input
                  type="radio"
                  name="restoreCascade"
                  className={styles.restoreOptionRadio}
                  checked={!cascade}
                  onChange={() => setCascade(false)}
                />
                <div className={styles.restoreOptionText}>
                  <span className={styles.restoreOptionPrimary}>이 업무만 단독 복구</span>
                  <span className={styles.restoreOptionDesc}>
                    선택한 상위 업무만 복구하며, 하위 업무는 휴지통에 보존됩니다.
                  </span>
                </div>
              </label>
            </div>
          )}

          <p className={styles.warningNote}>
            복구된 업무는 원래 소속 워크스페이스와 업무 목록으로 정상 복원됩니다.
          </p>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isRestoring}
          >
            취소
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={styles.deleteBtn}
            style={{ background: '#2563eb', borderColor: '#2563eb' }}
            onClick={handleConfirmClick}
            disabled={isRestoring}
          >
            {isRestoring ? '복구 중…' : '복구'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
