import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  AUTHORITY_BITS,
  parseAuthorityBitSet,
  type AuthorityBitInfo,
} from '../model/authorityDefinitions'
import type { RoleName } from '../model/types'
import styles from './RoleSaveConfirmModal.module.css'

export type RoleSaveConfirmModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  roleName: RoleName
  savedBitmask: string
  draftBitmask: string
  isSaving?: boolean
  isDisablingOwnRoleChange?: boolean
  isCreating?: boolean
}

export function RoleSaveConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  roleName,
  savedBitmask,
  draftBitmask,
  isSaving,
  isDisablingOwnRoleChange,
  isCreating = false,
}: RoleSaveConfirmModalProps) {
  const [acknowledgedLockout, setAcknowledgedLockout] = useState(false)

  if (!isOpen) return null

  const savedSet = parseAuthorityBitSet(savedBitmask)
  const draftSet = parseAuthorityBitSet(draftBitmask)

  const addedBits: AuthorityBitInfo[] = []
  const removedBits: AuthorityBitInfo[] = []
  const currentActiveBits: AuthorityBitInfo[] = []

  AUTHORITY_BITS.forEach((b) => {
    if (b.bit === 23) return // DENY
    const wasOn = savedSet.has(b.bit)
    const isOn = draftSet.has(b.bit)
    if (isOn) currentActiveBits.push(b)
    if (!wasOn && isOn) addedBits.push(b)
    if (wasOn && !isOn) removedBits.push(b)
  })

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="checkSquare" size={20} className={styles.headerIcon} />
            <div>
              <h3 className={styles.title}>
                {isCreating ? `'${roleName}' 역할 신규 생성 확인` : `${roleName} 역할 권한 변경 확인`}
              </h3>
              <p className={styles.subtitle}>
                {isCreating
                  ? '아래 설정된 권한으로 새로운 역할을 생성하시겠습니까? 저장 후 즉시 멤버에게 부여할 수 있습니다.'
                  : '아래 변경사항을 적용하시겠습니까? 저장 후 즉시 워크스페이스에 반영됩니다.'}
              </p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className={styles.body}>
          {/* 본인 역할의 ROLE_CHANGE 비활성화 시 강력 경고 배너 */}
          {isDisablingOwnRoleChange ? (
            <div className={styles.lockoutWarningCard}>
              <Icon name="alertTriangle" size={24} className={styles.lockoutWarningIcon} />
              <div className={styles.lockoutWarningContent}>
                <strong className={styles.lockoutWarningTitle}>
                  ⚠️ 치명적 경고: 본인의 권한 수정 권한이 상실됩니다!
                </strong>
                <p className={styles.lockoutWarningDesc}>
                  현재 소속된 <strong>{roleName}</strong> 역할에서 <strong>[역할 권한 정의/수정]</strong> 권한을 제거하려고 합니다.
                  이 변경사항을 저장하면 <strong>이후 본인을 포함한 {roleName} 역할의 모든 사용자는 권한 설정 탭을 수정할 수 없게 되며</strong>, 최고 관리자(ADMIN)만 복구할 수 있습니다.
                </p>
                <label className={styles.lockoutAckLabel}>
                  <input
                    type="checkbox"
                    checked={acknowledgedLockout}
                    onChange={(e) => setAcknowledgedLockout(e.target.checked)}
                    className={styles.lockoutAckCheckbox}
                  />
                  <span>위 위험성을 충분히 이해했으며, 권한 수정을 포기하고 저장을 진행합니다.</span>
                </label>
              </div>
            </div>
          ) : null}

          {/* 상단 권한 수치 비교 요약 */}
          <div className={styles.diffSummaryCard}>
            <div className={styles.diffSummaryColumn}>
              <span className={styles.summaryLabel}>{isCreating ? '생성 모드' : '기존 권한'}</span>
              <span className={styles.summaryCount}>
                <strong>{isCreating ? 0 : savedSet.size}</strong> / 22개 활성화
              </span>
            </div>
            <Icon name="arrowRight" size={18} className={styles.summaryArrow} />
            <div className={styles.diffSummaryColumn}>
              <span className={styles.summaryLabel}>신규 부여 권한</span>
              <span className={styles.summaryCountNew}>
                <strong>{draftSet.size}</strong> / 22개 활성화
              </span>
            </div>
          </div>

          {/* 변경 내역 리스트 */}
          <div className={styles.changeSection}>
            <h4 className={styles.changeHeading}>
              <span>{isCreating ? '포함되는 권한 목록' : '세부 변경 내역'}</span>
              <span className={styles.changeCountBadge}>
                {isCreating ? `${currentActiveBits.length}개 권한 부여` : `+${addedBits.length} 추가, -${removedBits.length} 제거`}
              </span>
            </h4>

            <div className={styles.changeList}>
              {isCreating ? (
                currentActiveBits.map((b) => (
                  <div key={`init-${b.bit}`} className={styles.changeItemAdd}>
                    <span className={styles.badgeAdd}>포함</span>
                    <div className={styles.changeInfo}>
                      <strong>{b.label}</strong>
                      <span>[{b.categoryLabel}] {b.description}</span>
                    </div>
                  </div>
                ))
              ) : (
                <>
                  {addedBits.map((b) => (
                    <div key={`add-${b.bit}`} className={styles.changeItemAdd}>
                      <span className={styles.badgeAdd}>+ 활성화</span>
                      <div className={styles.changeInfo}>
                        <strong>{b.label}</strong>
                        <span>[{b.categoryLabel}] {b.description}</span>
                      </div>
                    </div>
                  ))}

                  {removedBits.map((b) => (
                    <div key={`remove-${b.bit}`} className={styles.changeItemRemove}>
                      <span className={styles.badgeRemove}>- 비활성화</span>
                      <div className={styles.changeInfo}>
                        <strong>{b.label}</strong>
                        <span>[{b.categoryLabel}] {b.description}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {(!isCreating && addedBits.length === 0 && removedBits.length === 0) || (isCreating && currentActiveBits.length === 0) ? (
                <p className={styles.emptyNotice}>설정된 권한이 없습니다.</p>
              ) : null}
            </div>
          </div>
        </div>

        <footer className={styles.footer}>
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            disabled={isSaving || (isDisablingOwnRoleChange && !acknowledgedLockout)}
          >
            {isSaving ? (isCreating ? '역할 생성 중...' : '적용 저장 중...') : (isCreating ? '역할 생성 확정' : '확인 및 최종 저장')}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
