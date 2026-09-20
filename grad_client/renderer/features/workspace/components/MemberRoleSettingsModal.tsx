import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { FloatingMenu } from '../../../design-system/primitives/FloatingMenu'
import { getRoleBadgeStyle } from '../model/labels'
import type {
  AuthorityRecord,
  RoleName,
  RoleRemovalPreview,
  RoleRemovalTransferTarget,
} from '../model/types'
import styles from './MemberRoleSettingsModal.module.css'

export type MemberRoleSettingsSubmitResult = { ok: true } | { ok: false; message: string }

export type MemberRoleSettingsModalProps = {
  isOpen: boolean
  onClose: () => void
  userId: string
  userName: string
  userEmail: string
  nodeName: string
  currentRoleName: RoleName
  /** 현재 역할을 제외하고 새로 지정할 수 있는 역할 정의 목록 */
  assignableRoles: AuthorityRecord[]
  isSubmitting: boolean
  loadRemovalPreview: () => Promise<MemberRoleSettingsSubmitResult & { preview?: RoleRemovalPreview }>
  onSubmitRoleChange: (roleId: number) => Promise<MemberRoleSettingsSubmitResult>
  onSubmitRemoval: (newOwnerEmail?: string) => Promise<MemberRoleSettingsSubmitResult>
}

type SettingsMode = 'change' | 'remove'

export function MemberRoleSettingsModal({
  isOpen,
  onClose,
  userId,
  userName,
  userEmail,
  nodeName,
  currentRoleName,
  assignableRoles,
  isSubmitting,
  loadRemovalPreview,
  onSubmitRoleChange,
  onSubmitRemoval,
}: MemberRoleSettingsModalProps) {
  const [mode, setMode] = useState<SettingsMode>('change')
  const [selectedRole, setSelectedRole] = useState<number>(0)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const roleTriggerRef = useRef<HTMLButtonElement>(null)

  // 회수 모드 상태
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [preview, setPreview] = useState<RoleRemovalPreview | null>(null)
  const [selectedTransferTarget, setSelectedTransferTarget] = useState('')
  const [isTransferDropdownOpen, setIsTransferDropdownOpen] = useState(false)
  const transferTriggerRef = useRef<HTMLButtonElement>(null)

  const [errorMessage, setErrorMessage] = useState('')

  const wasOpenRef = useRef(false)

  // 닫힘 -> 열림 전환에서만 초기화한다.
  // (배경 데이터가 갱신되어 props 배열 identity 가 바뀌어도 입력 중인 상태를 지우지 않는다)
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true

    setMode('change')
    setSelectedRole(assignableRoles[0]?.id ?? 0)
    setIsDropdownOpen(false)
    setIsTransferDropdownOpen(false)
    setPreview(null)
    setSelectedTransferTarget('')
    setErrorMessage('')
  }, [isOpen, assignableRoles])

  // 회수 모드로 전환하면 이관 정보를 서버에서 한 번 불러온다.
  // effect 로 처리하면 부모 리렌더마다 정리(cleanup)가 실행되어 진행 중인 요청 결과가 버려지므로,
  // 사용자 동작에서 직접 시작한다.
  const loadPreview = async () => {
    setIsLoadingPreview(true)
    setErrorMessage('')
    try {
      const result = await loadRemovalPreview()
      if (result.ok && result.preview) {
        setPreview(result.preview)
        setSelectedTransferTarget(result.preview.transferTargets[0]?.email ?? '')
      } else if (!result.ok) {
        setErrorMessage(result.message)
      }
    } finally {
      setIsLoadingPreview(false)
    }
  }

  const handleModeChange = (nextMode: SettingsMode) => {
    setMode(nextMode)
    setIsDropdownOpen(false)
    setIsTransferDropdownOpen(false)
    setErrorMessage('')
    if (nextMode === 'remove' && !preview && !isLoadingPreview) {
      void loadPreview()
    }
  }

  const transferTargets = useMemo<RoleRemovalTransferTarget[]>(
    () => preview?.transferTargets ?? [],
    [preview],
  )

  const requiresTransfer = Boolean(preview && preview.workItems.length > 0)
  const canSubmitRemoval = Boolean(
    preview && preview.canRemove && (!requiresTransfer || selectedTransferTarget),
  )

  if (!isOpen) return null

  const handleSubmit = async () => {
    setErrorMessage('')

    if (mode === 'change') {
      const selected = assignableRoles.find((role) => role.id === selectedRole)
      if (!selected) {
        setErrorMessage('변경할 역할을 선택해 주세요.')
        return
      }
      const result = await onSubmitRoleChange(selected.id)
      if (!result.ok) {
        setErrorMessage(result.message)
        return
      }
      onClose()
      return
    }

    const result = await onSubmitRemoval(requiresTransfer ? selectedTransferTarget : undefined)
    if (!result.ok) {
      setErrorMessage(result.message)
      return
    }
    onClose()
  }

  return createPortal(
    <div className={styles.overlay} onClick={isSubmitting ? undefined : onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name="gear" size={20} className={styles.headerIcon} />
            <div className={styles.titleText}>
              <h2 className={styles.title}>멤버 역할 설정</h2>
              <span className={styles.subtitle}>
                {userName} · {userEmail || userId} · {nodeName}
              </span>
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
          {/* 모드 선택 */}
          <div className={styles.modeGroup} role="tablist" aria-label="역할 설정 모드">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'change'}
              className={[styles.modeBtn, mode === 'change' ? styles.modeBtnActive : ''].join(' ')}
              onClick={() => handleModeChange('change')}
              disabled={isSubmitting}
            >
              <Icon name="pencil" size={14} />
              <span>역할 변경</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'remove'}
              className={[styles.modeBtn, mode === 'remove' ? styles.modeBtnDanger : ''].join(' ')}
              onClick={() => handleModeChange('remove')}
              disabled={isSubmitting}
            >
              <Icon name="trash" size={14} />
              <span>역할 회수</span>
            </button>
          </div>

          {mode === 'change' ? (
            <div className={styles.formGroup}>
              <label className={styles.label}>
                <span>변경할 역할 (Role)</span>
                <span className={styles.requiredMark}>*</span>
              </label>

              <div className={styles.roleSelectorWrapper}>
                <button
                  ref={roleTriggerRef}
                  type="button"
                  className={[styles.roleTrigger, isDropdownOpen ? styles.roleTriggerActive : ''].join(' ')}
                  onClick={() => setIsDropdownOpen((prev) => !prev)}
                  disabled={isSubmitting || assignableRoles.length === 0}
                >
                  <span className={styles.selectedRoleContent}>
                    <span className={styles.currentRoleLabel}>현재</span>
                    <span className={styles.roleBadge} style={getRoleBadgeStyle(currentRoleName)}>
                      {currentRoleName}
                    </span>
                    <Icon name="arrowRight" size={13} className={styles.arrowIcon} />
                    <span className={styles.roleBadge} style={getRoleBadgeStyle(assignableRoles.find((role) => role.id === selectedRole)?.roleName ?? '')}>
                      {assignableRoles.find((role) => role.id === selectedRole)?.roleName ?? '선택 가능한 역할 없음'}
                    </span>
                  </span>
                  <Icon
                    name="chevronDown"
                    size={14}
                    className={[styles.roleChevron, isDropdownOpen ? styles.roleChevronOpen : ''].join(' ')}
                  />
                </button>

                <FloatingMenu
                  anchorRef={roleTriggerRef}
                  isOpen={isDropdownOpen}
                  onClose={() => setIsDropdownOpen(false)}
                  className={styles.roleDropdownMenu}
                  maxHeight={240}
                >
                  {assignableRoles.map((role) => {
                    const isSelected = selectedRole === role.id
                    return (
                      <button
                        key={role.id}
                        type="button"
                        className={[styles.roleOption, isSelected ? styles.roleOptionActive : ''].join(' ')}
                        onClick={() => {
                          setSelectedRole(role.id)
                          setIsDropdownOpen(false)
                        }}
                      >
                        <span className={styles.roleBadge} style={getRoleBadgeStyle(role.roleName)}>
                          {role.roleName}
                        </span>
                        {isSelected ? <Icon name="checkCircle" size={14} /> : null}
                      </button>
                    )
                  })}
                </FloatingMenu>
              </div>
              <span className={styles.hint}>
                이 공간에 직접 부여되는 역할을 바꿉니다. 상위 공간의 권한보다 우선 적용됩니다.
              </span>
            </div>
          ) : (
            <div className={styles.removeSection}>
              {isLoadingPreview ? (
                <div className={styles.loadingBox}>
                  <Icon name="clock" size={16} />
                  <span>이관해야 할 업무를 확인하는 중입니다...</span>
                </div>
              ) : preview ? (
                <>
                  <div className={styles.summaryBox}>
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>회수할 역할</span>
                      <span className={styles.roleBadge} style={getRoleBadgeStyle(preview.roleName)}>
                        {preview.roleName}
                      </span>
                    </div>
                    <div className={styles.summaryRow}>
                      <span className={styles.summaryLabel}>이관할 미완료 업무</span>
                      <strong className={styles.summaryValue}>{preview.workItems.length}건</strong>
                    </div>
                  </div>

                  {preview.workItems.length > 0 ? (
                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        <span>이관할 업무</span>
                      </label>
                      <ul className={styles.workItemList}>
                        {preview.workItems.map((item) => (
                          <li key={item.workItemId} className={styles.workItemRow}>
                            <span className={styles.workItemTitle}>{item.title}</span>
                            <span className={styles.workItemMeta}>
                              {item.ownerNodeName}
                              {item.isHidden ? <span className={styles.hiddenTag}>숨김</span> : null}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <span className={styles.hint}>
                        완료된 업무는 그대로 두고, 위 미완료 업무만 새 담당자에게 이관합니다.
                      </span>
                    </div>
                  ) : (
                    <span className={styles.hint}>이관할 미완료 업무가 없습니다.</span>
                  )}

                  {preview.workItems.length > 0 ? (
                    <div className={styles.formGroup}>
                      <label className={styles.label}>
                        <span>업무를 이관할 담당자</span>
                        <span className={styles.requiredMark}>*</span>
                      </label>

                      {transferTargets.length === 0 ? (
                        <div className={styles.warnBox}>
                          <Icon name="alertTriangle" size={15} />
                          <span>
                            이관 가능한 대상이 없습니다. 먼저 이관 대상에게 업무 수행 권한을 부여해 주세요.
                          </span>
                        </div>
                      ) : (
                        <div className={styles.roleSelectorWrapper}>
                          <button
                            ref={transferTriggerRef}
                            type="button"
                            className={[styles.roleTrigger, isTransferDropdownOpen ? styles.roleTriggerActive : ''].join(' ')}
                            onClick={() => setIsTransferDropdownOpen((prev) => !prev)}
                            disabled={isSubmitting}
                          >
                            <span className={styles.selectedRoleContent}>
                              {transferTargets.find((target) => target.email === selectedTransferTarget)?.name ??
                                '이관할 담당자를 선택해 주세요'}
                            </span>
                            <Icon
                              name="chevronDown"
                              size={14}
                              className={[styles.roleChevron, isTransferDropdownOpen ? styles.roleChevronOpen : ''].join(' ')}
                            />
                          </button>

                          <FloatingMenu
                            anchorRef={transferTriggerRef}
                            isOpen={isTransferDropdownOpen}
                            onClose={() => setIsTransferDropdownOpen(false)}
                            className={styles.roleDropdownMenu}
                            maxHeight={240}
                          >
                            {transferTargets.map((target) => {
                              const isSelected = selectedTransferTarget === target.email
                              return (
                                <button
                                  key={target.userId}
                                  type="button"
                                  className={[styles.roleOption, isSelected ? styles.roleOptionActive : ''].join(' ')}
                                  onClick={() => {
                                    setSelectedTransferTarget(target.email)
                                    setIsTransferDropdownOpen(false)
                                  }}
                                >
                                  <span className={styles.targetOption}>
                                    <strong>{target.name}</strong>
                                    <span className={styles.targetEmail}>{target.email}</span>
                                  </span>
                                  {isSelected ? <Icon name="checkCircle" size={14} /> : null}
                                </button>
                              )
                            })}
                          </FloatingMenu>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {preview.blockedReason ? (
                    <div className={styles.warnBox}>
                      <Icon name="alertTriangle" size={15} />
                      <span>{preview.blockedReason}</span>
                    </div>
                  ) : (
                    <div className={styles.dangerNote}>
                      <Icon name="alertTriangle" size={14} />
                      <span>
                        역할을 회수하면 이 공간에 직접 부여된 권한이 사라집니다. 상속된 권한만 남습니다.
                      </span>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {errorMessage ? (
            <div className={styles.errorBox}>
              <Icon name="alertTriangle" size={15} />
              <span>{errorMessage}</span>
            </div>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            취소
          </Button>
          <Button
            type="button"
            variant="primary"
            className={mode === 'remove' ? styles.dangerBtn : undefined}
            onClick={() => void handleSubmit()}
            disabled={
              isSubmitting ||
              (mode === 'change'
                ? assignableRoles.length === 0
                : isLoadingPreview || !preview || !canSubmitRemoval)
            }
          >
            {isSubmitting ? '처리 중...' : mode === 'remove' ? '역할 회수' : '역할 변경'}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}