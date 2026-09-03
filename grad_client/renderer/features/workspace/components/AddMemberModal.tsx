import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { getRoleBadgeStyle } from '../model/labels'
import type { RoleName } from '../model/types'
import { ToastAlertModal } from '../../../design-system/primitives/ToastAlertModal'
import styles from './AddMemberModal.module.css'

export type AddMemberModalProps = {
  isOpen: boolean
  onClose: () => void
  onConfirm: (email: string, roleName: RoleName) => Promise<void>
  availableRoles: RoleName[]
  isSubmitting?: boolean
}

export function AddMemberModal({
  isOpen,
  onClose,
  onConfirm,
  availableRoles,
  isSubmitting = false,
}: AddMemberModalProps) {
  const [email, setEmail] = useState('')
  const [selectedRole, setSelectedRole] = useState<RoleName>('MEMBER')
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 경고 팝업 상태
  const [warnMessage, setWarnMessage] = useState('')

  // 기본 선택 역할 설정 (availableRoles에 있는 역할 중 우선순위)
  useEffect(() => {
    if (isOpen) {
      setEmail('')
      if (availableRoles.includes('MEMBER')) {
        setSelectedRole('MEMBER')
      } else if (availableRoles.length > 0) {
        setSelectedRole(availableRoles[0])
      }
      setIsDropdownOpen(false)
      setWarnMessage('')
    }
  }, [isOpen, availableRoles])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setWarnMessage('사용자 이메일을 입력해주세요.')
      return
    }
    onConfirm(trimmedEmail, selectedRole)
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="users" size={20} className={styles.headerIcon} />
            <h2 className={styles.title}>공간에 사용자 추가</h2>
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

        <form onSubmit={handleSubmit}>
          <div className={styles.body}>
            {/* 이메일 입력 */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                <span>사용자 이메일</span>
                <span className={styles.requiredMark}>*</span>
              </label>
              <input
                type="email"
                className={styles.input}
                placeholder="예: user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                autoFocus
                required
              />
              <span className={styles.hint}>
                시스템에 등록된 사용자의 이메일 주소를 입력해 주세요.
              </span>
            </div>

            {/* 역할 선택 */}
            <div className={styles.formGroup}>
              <label className={styles.label}>
                <span>부여할 역할 (Role)</span>
                <span className={styles.requiredMark}>*</span>
              </label>

              <div className={styles.roleSelectorWrapper} ref={dropdownRef}>
                <button
                  type="button"
                  className={[styles.roleTrigger, isDropdownOpen ? styles.roleTriggerActive : ''].join(' ')}
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                  disabled={isSubmitting}
                >
                  <div className={styles.selectedRoleContent}>
                    <span className={styles.roleBadge} style={getRoleBadgeStyle(selectedRole)}>
                      {selectedRole}
                    </span>
                  </div>
                  <Icon
                    name="chevronDown"
                    size={14}
                    className={[styles.roleChevron, isDropdownOpen ? styles.roleChevronOpen : ''].join(' ')}
                  />
                </button>

                {isDropdownOpen ? (
                  <div className={styles.roleDropdownMenu}>
                    {availableRoles.map((role) => {
                      const isSelected = selectedRole === role
                      return (
                        <button
                          key={role}
                          type="button"
                          className={[styles.roleOption, isSelected ? styles.roleOptionActive : ''].join(' ')}
                          onClick={() => {
                            setSelectedRole(role)
                            setIsDropdownOpen(false)
                          }}
                        >
                          <span className={styles.roleBadge} style={getRoleBadgeStyle(role)}>
                            {role}
                          </span>
                          {isSelected ? <Icon name="checkCircle" size={14} /> : null}
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
              <span className={styles.hint}>
                추가된 사용자에게 적용될 역할 및 세부 권한입니다.
              </span>
            </div>
          </div>

          <footer className={styles.footer}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || !email.trim()}
            >
              {isSubmitting ? '추가 중...' : '사용자 추가'}
            </Button>
          </footer>
        </form>
      </div>

      <ToastAlertModal
        isOpen={Boolean(warnMessage)}
        onClose={() => setWarnMessage('')}
        title="입력 확인"
        message={warnMessage}
        type="warning"
      />
    </div>,
    document.body,
  )
}
