import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { getRoleBadgeStyle } from '../model/labels'
import type { RoleDefinitionDeletionPreview } from '../model/types'
import styles from './RoleDefinitionDeleteModal.module.css'

export type RoleDefinitionDeleteSubmitResult = { ok: true } | { ok: false; message: string }

export type RoleDefinitionDeleteModalProps = {
  isOpen: boolean
  onClose: () => void
  /** 역할이 정의된 워크스페이스(노드) 이름 */
  nodeName: string
  roleName: string
  /** 서버에서 조회한 삭제 가능 여부 / 배정된 사용자 목록 */
  preview: RoleDefinitionDeletionPreview | null
  isLoadingPreview: boolean
  isSubmitting: boolean
  /** 배정된 사용자가 남아 있는 동안 다시 확인할 때 사용한다. */
  onReloadPreview: () => void
  onConfirmDelete: () => Promise<RoleDefinitionDeleteSubmitResult>
}

export function RoleDefinitionDeleteModal({
  isOpen,
  onClose,
  nodeName,
  roleName,
  preview,
  isLoadingPreview,
  isSubmitting,
  onReloadPreview,
  onConfirmDelete,
}: RoleDefinitionDeleteModalProps) {
  const [errorMessage, setErrorMessage] = useState('')

  if (!isOpen) return null

  const assignees = preview?.assignees ?? []
  const canDelete = Boolean(preview?.canDelete)

  const handleConfirm = async () => {
    setErrorMessage('')
    const result = await onConfirmDelete()
    if (!result.ok) {
      setErrorMessage(result.message)
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      onClick={isSubmitting ? undefined : onClose}
      role="dialog"
      aria-modal="true"
      aria-label="역할 삭제"
    >
      <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="trash" size={20} className={styles.headerIcon} />
            <div className={styles.titleText}>
              <h2 className={styles.title}>역할 삭제</h2>
              <span className={styles.subtitle}>{nodeName}</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="닫기"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.summaryBox}>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>삭제할 역할</span>
              <span className={styles.roleBadge} style={getRoleBadgeStyle(roleName)}>
                {roleName}
              </span>
            </div>
            <div className={styles.summaryRow}>
              <span className={styles.summaryLabel}>배정된 사용자</span>
              <strong className={styles.summaryValue}>
                {isLoadingPreview ? '확인 중...' : `${preview?.assigneeCount ?? 0}명`}
              </strong>
            </div>
          </div>

          {isLoadingPreview ? (
            <div className={styles.loadingBox}>
              <Icon name="clock" size={16} />
              <span>이 역할을 배정받은 사용자를 확인하는 중입니다...</span>
            </div>
          ) : (
            <>
              {assignees.length > 0 ? (
                <div className={styles.formGroup}>
                  <span className={styles.label}>이 역할을 배정받은 사용자</span>
                  <ul className={styles.assigneeList}>
                    {assignees.map((assignee) => (
                      <li key={assignee.userId} className={styles.assigneeRow}>
                        <span className={styles.assigneeName}>{assignee.name}</span>
                        <span className={styles.assigneeEmail}>{assignee.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preview?.blockedReason ? (
                <div className={styles.warnBox}>
                  <Icon name="alertTriangle" size={15} />
                  <span>{preview.blockedReason}</span>
                </div>
              ) : (
                <div className={styles.dangerNote}>
                  <Icon name="alertTriangle" size={14} />
                  <span>
                    역할을 삭제하면 되돌릴 수 없습니다. 같은 이름으로 다시 만들어도 기존 권한 설정은 복구되지 않습니다.
                  </span>
                </div>
              )}

              {preview && !canDelete ? (
                <span className={styles.hint}>
                  사용자 탭에서 위 사용자들의 역할을 다른 역할로 모두 변경한 뒤 다시 확인해 주세요.
                </span>
              ) : null}

              {(preview?.inactiveAssigneeCount ?? 0) > 0 ? (
                <span className={styles.hint}>
                  탈퇴한 사용자 {preview?.inactiveAssigneeCount}명의 잔여 배정은 역할과 함께 정리됩니다.
                </span>
              ) : null}
            </>
          )}

          {errorMessage ? (
            <div className={styles.errorBox}>
              <Icon name="alertTriangle" size={15} />
              <span>{errorMessage}</span>
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          {preview && !canDelete ? (
            <Button type="button" variant="secondary" onClick={onReloadPreview} disabled={isSubmitting || isLoadingPreview}>
              다시 확인
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            type="button"
            variant="primary"
            className={styles.dangerBtn}
            onClick={() => void handleConfirm()}
            disabled={isSubmitting || isLoadingPreview || !preview || !canDelete}
          >
            {isSubmitting ? '삭제 중...' : '역할 삭제'}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
