import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  AUTHORITY_BITS,
  AUTHORITY_PRESETS,
  getCascadeImpact,
  parseAuthorityBitSet,
  stringifyAuthorityBitSet,
  toggleAuthorityBit,
  type AuthorityBitInfo,
  type AuthorityPreset,
} from '../model/authorityDefinitions'
import { getRoleBadgeStyle } from '../model/labels'
import { getRolePriorityScore } from '../model/memberInheritance'
import { canChangeRoleDefinitions } from '../model/effectiveAuthority'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleName,
  UserRecord,
} from '../model/types'
import {
  createRoleDefinitionOnServer,
  renameRoleDefinitionOnServer,
  updateRoleAuthorityOnServer,
} from '../data/server/serverWorkspace'
import { RoleSaveConfirmModal } from './RoleSaveConfirmModal'
import { ToastAlertModal, type AlertType } from '../../../design-system/primitives/ToastAlertModal'
import styles from './WorkspaceRolesTab.module.css'
import menuStyles from './FileContextMenu.module.css'

type WorkspaceRolesTabProps = {
  rootNode?: OrganizationNodeRecord | null
  authorities?: AuthorityRecord[]
  roles?: RoleAssignmentRecord[]
  currentUserId?: string
  currentUser?: UserRecord | null
}


export function WorkspaceRolesTab({
  rootNode,
  authorities = [],
  roles = [],
  currentUserId,
}: WorkspaceRolesTabProps) {
  const [selectedRole, setSelectedRole] = useState<RoleName>('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const presetDropdownRef = useRef<HTMLDivElement>(null)
  const [roleMenu, setRoleMenu] = useState<{ role: string; x: number; y: number } | null>(null)
  const roleMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!roleMenu) return
    const menu = roleMenuRef.current
    if (menu) {
      const bounds = menu.getBoundingClientRect()
      menu.style.left = `${Math.max(8, Math.min(roleMenu.x, window.innerWidth - bounds.width - 8))}px`
      menu.style.top = `${Math.max(8, Math.min(roleMenu.y, window.innerHeight - bounds.height - 8))}px`
      menu.querySelector('button')?.focus()
    }
    const close = () => setRoleMenu(null)
    const pointer = (event: PointerEvent) => {
      if (!roleMenuRef.current?.contains(event.target as Node)) close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') close()
    }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', pointer)
      window.removeEventListener('keydown', key)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [roleMenu])

  // 모던 알림/에러 모달 상태
  const [alertInfo, setAlertInfo] = useState<{ isOpen: boolean; message: string; title?: string; type?: AlertType }>({
    isOpen: false,
    message: '',
  })
  const showAlert = (message: string, title?: string, type: AlertType = 'error') => {
    setAlertInfo({ isOpen: true, message, title, type })
  }

  // 신규 역할 생성 모드 상태
  const [isCreatingRole, setIsCreatingRole] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleBitmask, setNewRoleBitmask] = useState('000100110000001101010111') // 기본 MEMBER 프리셋

  // 역할 이름 변경 모드 상태
  const [isRenamingRole, setIsRenamingRole] = useState(false)
  const [editRoleName, setEditRoleName] = useState('')

  // 외부 클릭 시 프리셋 메뉴 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (presetDropdownRef.current && !presetDropdownRef.current.contains(e.target as Node)) {
        setIsPresetOpen(false)
      }
    }
    if (isPresetOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isPresetOpen])

  // 호버 중인 비트 및 그로 인해 영향받는 연쇄 비트 집합 (UX 안내 하이라이트)
  const [hoveredBit, setHoveredBit] = useState<number | null>(null)

  const nodeDefinitions = useMemo(() => authorities.filter((a) => a.nodeId === rootNode?.id), [authorities, rootNode?.id])
  const definitionById = useMemo(() => new Map(nodeDefinitions.map((a) => [String(a.id), a])), [nodeDefinitions])
  const roleLabel = (id: string) => definitionById.get(id)?.roleName ?? '역할 정보 없음'
  const roleBitmaskMap = useMemo(() => new Map(nodeDefinitions.map((a) => [String(a.id), a.authority])), [nodeDefinitions])
  const allRoleNames = useMemo(() => [...nodeDefinitions].sort((a, b) =>
    Number(Boolean(b.isTopRole)) - Number(Boolean(a.isTopRole)) ||
    getRolePriorityScore(String(b.id), roleBitmaskMap) - getRolePriorityScore(String(a.id), roleBitmaskMap) ||
    a.roleName.localeCompare(b.roleName, 'ko'),
  ).map((a) => String(a.id)), [nodeDefinitions, roleBitmaskMap])
  useEffect(() => {
    if (!definitionById.has(selectedRole)) setSelectedRole(allRoleNames[0] ?? '')
  }, [allRoleNames, definitionById, selectedRole])

  // 실제 저장된(반영된) 권한 상태
  const [savedBitmaskMap, setSavedBitmaskMap] = useState<Map<RoleName, string>>(
    () => new Map(roleBitmaskMap),
  )

  // 서버 authorities가 갱신될 때 동기화
  useEffect(() => {
    setSavedBitmaskMap(new Map(roleBitmaskMap))
    setDraftBitmaskMap(new Map(roleBitmaskMap))
  }, [roleBitmaskMap])

  // 현재 편집 중(Draft)인 권한 상태
  const [draftBitmaskMap, setDraftBitmaskMap] = useState<Map<RoleName, string>>(
    () => new Map(roleBitmaskMap),
  )

  const getDefaultAuthority = (_role: RoleName): string => '000000000000000000000000'

  const currentBitmaskStr = isCreatingRole
    ? newRoleBitmask
    : draftBitmaskMap.get(selectedRole) || getDefaultAuthority(selectedRole)
  const savedBitmaskStr = isCreatingRole
    ? '000000000000000000000000'
    : savedBitmaskMap.get(selectedRole) || getDefaultAuthority(selectedRole)
  const isDirty = isCreatingRole ? true : currentBitmaskStr !== savedBitmaskStr

  const currentBitSet = useMemo(() => parseAuthorityBitSet(currentBitmaskStr), [currentBitmaskStr])
  const savedBitSet = useMemo(() => parseAuthorityBitSet(savedBitmaskStr), [savedBitmaskStr])

  // 현재 로그인한 사용자의 직속 역할 확인
  const currentUserRole = useMemo(() => {
    if (!currentUserId || !rootNode) return null
    const myRole = roles.find((r) => !r.isDeleted && r.nodeId === rootNode.id && r.userId === currentUserId)
    return myRole?.roleId ? String(myRole.roleId) : null
  }, [currentUserId, roles, rootNode])

  const isCurrentUserAdmin = Boolean(currentUserRole && definitionById.get(currentUserRole)?.isTopRole)

  // 역할 정의(권한/이름) 변경은 해당 노드에 `직속`으로 ROLE_CHANGE(Bit 15)를 가진 사용자만 가능하다.
  // 서버(create_role_definition/update_role_authority/rename_role_definition)와 동일한 기준을 사용한다.
  const canManageRoles = useMemo(
    () =>
      Boolean(
        currentUserId &&
          rootNode &&
          canChangeRoleDefinitions(currentUserId, rootNode.id, { roles, authorities }),
      ),
    [authorities, currentUserId, roles, rootNode],
  )

  const isSelectedAdmin = !isCreatingRole && definitionById.get(selectedRole)?.isTopRole === true
  const isEditable = canManageRoles && !isSelectedAdmin

  const startCreatingRole = (authority = '000100110000001101010111') => {
    if (!canManageRoles || isSaving) return
    setIsCreatingRole(true)
    setIsRenamingRole(false)
    setEditRoleName('')
    setNewRoleName('')
    setNewRoleBitmask(authority)
    setIsPresetOpen(false)
    setIsConfirmModalOpen(false)
    setSaveSuccess(false)
    setHoveredBit(null)
    setRoleMenu(null)
  }

  // 자신이 소속된 역할(예: MANAGER)의 '역할 권한 정의/수정(ROLE_CHANGE)'을 끄려고 하는지 여부
  const isDisablingOwnRoleChange = useMemo(() => {
    if (isCurrentUserAdmin || !currentUserRole) return false
    if (selectedRole !== currentUserRole) return false
    const wasOn = savedBitSet.has(15)
    const isNowOff = !currentBitSet.has(15)
    return wasOn && isNowOff
  }, [isCurrentUserAdmin, currentUserRole, selectedRole, savedBitSet, currentBitSet])

  // 호버 시 연쇄적으로 변경될 비트 계산
  const hoverImpact = useMemo(() => {
    if (hoveredBit === null || !isEditable) return { addedBits: [], removedBits: [] }
    const isCurrentlyOn = currentBitSet.has(hoveredBit)
    return getCascadeImpact(currentBitSet, hoveredBit, !isCurrentlyOn)
  }, [currentBitSet, hoveredBit, isEditable])

  const hoverAddedSet = useMemo(() => new Set(hoverImpact.addedBits), [hoverImpact.addedBits])
  const hoverRemovedSet = useMemo(() => new Set(hoverImpact.removedBits), [hoverImpact.removedBits])

  // 권한 토글 핸들러 (의존성 체인 자동 처리 + 연계 피드백 메시지 생성)
  const handleToggleBit = (bit: number) => {
    if (!isEditable) return
    // DENY(Bit 23)는 최상위 담당자만 수정 가능
    if (bit === 23 && !isCurrentUserAdmin) {
      return
    }

    const isCurrentlyOn = currentBitSet.has(bit)
    const targetValue = !isCurrentlyOn
    const nextSet = toggleAuthorityBit(currentBitSet, bit, targetValue)
    const nextBitmaskStr = stringifyAuthorityBitSet(nextSet)

    if (isCreatingRole) {
      setNewRoleBitmask(nextBitmaskStr)
    } else {
      setDraftBitmaskMap((prev) => {
        const nextMap = new Map(prev)
        nextMap.set(selectedRole, nextBitmaskStr)
        return nextMap
      })
    }
    setSaveSuccess(false)
  }

  // 수정 취소 (원래 저장 상태로 되돌리기 / 신규 생성 취소)
  const handleRevertChanges = () => {
    if (isCreatingRole) {
      setIsCreatingRole(false)
      setNewRoleName('')
      setSelectedRole('MANAGER')
      return
    }
    if (!isEditable || !isDirty) return
    setDraftBitmaskMap((prev) => {
      const nextMap = new Map(prev)
      nextMap.set(selectedRole, savedBitmaskStr)
      return nextMap
    })
    setSaveSuccess(false)
  }

  // 프리셋 템플릿 적용
  const handleApplyPreset = (preset: AuthorityPreset) => {
    if (!isEditable) return
    // ADMIN이 아닌 경우 DENY 비트는 0으로 강제 유지
    let bitmask = preset.bitmask
    if (!isCurrentUserAdmin && bitmask[0] === '1') {
      bitmask = '0' + bitmask.slice(1)
    }
    if (isCreatingRole) {
      setNewRoleBitmask(bitmask)
    } else {
      setDraftBitmaskMap((prev) => {
        const nextMap = new Map(prev)
        nextMap.set(selectedRole, bitmask)
        return nextMap
      })
    }
    setSaveSuccess(false)
  }

  // 변경사항 저장 모달 열기
  const handleOpenSaveConfirm = () => {
    if (!isEditable) return
    if (isCreatingRole) {
      const trimmed = newRoleName.trim()
      if (!trimmed) {
        showAlert('역할 이름을 입력해주세요.', '입력 확인', 'warning')
        return
      }
      if (nodeDefinitions.some((a) => a.roleName === trimmed)) {
        showAlert('이미 존재하는 역할 이름입니다.', '중복 확인', 'warning')
        return
      }
      setIsConfirmModalOpen(true)
      return
    }
    if (!isDirty) return
    setIsConfirmModalOpen(true)
  }

  // 최종 저장 확정 처리 (생성 또는 수정)
  const handleConfirmSave = async () => {
    if (!rootNode) return
    setIsSaving(true)
    try {
      const targetBitmask = currentBitmaskStr

      if (isCreatingRole) {
        const trimmedName = newRoleName.trim()
        const result = await createRoleDefinitionOnServer({
          nodeId: rootNode.id,
          roleName: trimmedName,
          authority: targetBitmask,
        })

        if (result.status === 'error') {
          showAlert(result.message || '새 역할을 생성하지 못했습니다.', '역할 생성 실패', 'error')
          return
        }

        setIsCreatingRole(false)
        setSelectedRole('')
        setNewRoleName('')
      } else {
        const result = await updateRoleAuthorityOnServer({
          nodeId: rootNode.id,
          roleId: Number(selectedRole),
          roleName: roleLabel(selectedRole),
          authority: targetBitmask,
        })

        if (result.status === 'error') {
          showAlert(result.message || '역할 권한을 저장하지 못했습니다.', '권한 저장 실패', 'error')
          return
        }

        setSavedBitmaskMap(new Map(draftBitmaskMap))
      }

      setSaveSuccess(true)
      setIsConfirmModalOpen(false)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('[WorkspaceRolesTab] 권한 저장 실패:', err)
      showAlert('서버 통신 중 오류가 발생했습니다.', '통신 오류', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // 역할 이름 변경 확정 핸들러
  const handleRenameRole = async () => {
    if (!rootNode) return
    const trimmed = editRoleName.trim()
    if (!trimmed) {
      showAlert('변경할 역할 이름을 입력해주세요.', '입력 확인', 'warning')
      return
    }

    if (trimmed === roleLabel(selectedRole)) {
      setIsRenamingRole(false)
      return
    }
    if (nodeDefinitions.some((a) => a.roleName === trimmed)) {
      showAlert('이미 존재하는 역할 이름입니다.', '중복 확인', 'warning')
      return
    }

    setIsSaving(true)
    try {
      const result = await renameRoleDefinitionOnServer({
        nodeId: rootNode.id,
        roleId: Number(selectedRole),
        oldRoleName: roleLabel(selectedRole),
        newRoleName: trimmed,
      })

      if (result.status === 'error') {
        showAlert(result.message || '역할 이름을 변경하지 못했습니다.', '이름 변경 실패', 'error')
        return
      }

      // 상태 갱신
      setIsRenamingRole(false)

      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      console.error('[WorkspaceRolesTab] 역할 이름 변경 실패:', err)
      showAlert('서버 통신 중 오류가 발생했습니다.', '통신 오류', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  // 좌측 열과 우측 열 도메인 분할
  // 좌측: 공간 및 노드 (4개) + 공간 관리 (2개) + 역할 및 인원 관리 (2개) + 활동 히스토리 (2개) = 총 10개
  // 우측: 업무 (WorkItem) (7개) + 파일 및 산출물 (2개) + 특수 제어 (1개) = 총 10개
  const { leftGroups, rightGroups } = useMemo(() => {
    const getCategoryBits = (cat: AuthorityBitInfo['category']) => {
      const bits = AUTHORITY_BITS.filter((b) => b.category === cat)
      return {
        category: cat,
        categoryLabel: bits[0]?.categoryLabel || '',
        bits,
      }
    }

    const leftCats: AuthorityBitInfo['category'][] = ['space', 'manage', 'role', 'history']
    const rightCats: AuthorityBitInfo['category'][] = ['work', 'file', 'special']

    return {
      leftGroups: leftCats.map(getCategoryBits).filter((g) => g.bits.length > 0),
      rightGroups: rightCats.map(getCategoryBits).filter((g) => g.bits.length > 0),
    }
  }, [])

  const activeCount = AUTHORITY_BITS.filter((b) => b.bit !== 23 && currentBitSet.has(b.bit)).length
  const totalCount = AUTHORITY_BITS.filter((b) => b.bit !== 23).length

  // 공통 그룹 카드 렌더러
  const renderGroupCard = (group: { category: string; categoryLabel: string; bits: AuthorityBitInfo[] }) => {
    const groupActiveCount = group.bits.filter((b) => b.bit !== 23 && currentBitSet.has(b.bit)).length
    const groupTotalCount = group.bits.filter((b) => b.bit !== 23).length

    return (
      <section key={group.category} className={styles.groupCard}>
        <div className={styles.groupHeader}>
          <h3 className={styles.groupTitle}>{group.categoryLabel}</h3>
          {group.category !== 'special' ? (
            <span className={styles.groupActiveBadge}>
              {groupActiveCount} / {groupTotalCount} 활성
            </span>
          ) : null}
        </div>

        <div className={styles.bitList}>
          {group.bits.map((bitInfo) => {
            const isChecked = currentBitSet.has(bitInfo.bit)
            const wasChecked = savedBitSet.has(bitInfo.bit)
            const isDeny = bitInfo.bit === 23

            const isNewlyAdded = !wasChecked && isChecked
            const isNewlyRemoved = wasChecked && !isChecked

            const isHoverTarget = hoveredBit === bitInfo.bit
            const willCascadeAdd = hoverAddedSet.has(bitInfo.bit) && !isHoverTarget
            const willCascadeRemove = hoverRemovedSet.has(bitInfo.bit) && !isHoverTarget

            const prereqLabels = bitInfo.prerequisites
              .map((p) => AUTHORITY_BITS.find((b) => b.bit === p)?.label)
              .filter(Boolean)

            const isBitEditable = isEditable && (!isDeny || isCurrentUserAdmin)

            return (
              <div
                key={bitInfo.bit}
                className={[
                  styles.bitRow,
                  isChecked ? styles.bitRowActive : '',
                  isDeny ? styles.bitRowDeny : '',
                  !isBitEditable ? styles.bitRowDisabled : '',
                  willCascadeAdd ? styles.bitRowCascadeAdd : '',
                  willCascadeRemove ? styles.bitRowCascadeRemove : '',
                ].join(' ')}
                onMouseEnter={() => setHoveredBit(bitInfo.bit)}
                onMouseLeave={() => setHoveredBit(null)}
              >
                <div className={styles.bitLeft}>
                  <div className={styles.bitTitleBlock}>
                    <strong className={styles.bitLabel}>{bitInfo.label}</strong>

                    {isDeny && !isCurrentUserAdmin ? (
                      <span className={styles.adminOnlyBadge} title="최상위 담당자만 수정할 수 있습니다.">
                        <Icon name="lock" size={10} />
                        최상위 역할 전용
                      </span>
                    ) : null}

                    {isNewlyAdded ? (
                      <span className={styles.diffBadgeAdd}>+ 새로 추가됨</span>
                    ) : isNewlyRemoved ? (
                      <span className={styles.diffBadgeRemove}>- 제거됨</span>
                    ) : null}

                    {willCascadeAdd ? (
                      <span className={styles.cascadeHintAdd}>함께 켜짐</span>
                    ) : willCascadeRemove ? (
                      <span className={styles.cascadeHintRemove}>함께 꺼짐</span>
                    ) : null}
                  </div>

                  <p className={styles.bitDesc}>{bitInfo.description}</p>

                  {prereqLabels.length > 0 ? (
                    <div className={styles.prereqRow}>
                      <Icon name="arrowRight" size={11} className={styles.prereqArrow} />
                      <span>필수 선행 조건:</span>
                      {bitInfo.prerequisites.map((pBit) => {
                        const pInfo = AUTHORITY_BITS.find((b) => b.bit === pBit)
                        const isPrereqMet = currentBitSet.has(pBit)
                        return (
                          <button
                            key={pBit}
                            type="button"
                            className={[
                              styles.prereqBadgeBtn,
                              isPrereqMet ? styles.prereqMet : styles.prereqUnmet,
                            ].join(' ')}
                            title={
                              isPrereqMet
                                ? '선행 권한 활성 상태'
                                : '선행 권한 비활성 상태 (클릭 시 자동 활성화)'
                            }
                            disabled={!isEditable}
                            onClick={() => {
                              if (!isPrereqMet) {
                                handleToggleBit(pBit)
                              }
                            }}
                          >
                            <Icon
                              name={isPrereqMet ? 'checkCircle' : 'alertTriangle'}
                              size={11}
                            />
                            <span>{pInfo?.label || `권한 ${pBit}`}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>

                <div className={styles.bitRight}>
                  <label className={styles.switchLabel}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      disabled={!isBitEditable}
                      onChange={() => handleToggleBit(bitInfo.bit)}
                      className={styles.switchInput}
                    />
                    <span className={styles.switchSlider} />
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  return (
    <div className={styles.container}>
      {/* 권한 수정 불가 시 안내 배너 */}
      {!canManageRoles ? (
        <div className={styles.readonlyBanner}>
          <Icon name="lock" size={15} className={styles.readonlyIcon} />
          <span className={styles.readonlyText}>
            읽기 전용 모드 · 이 공간에 직접 부여된 <code>ROLE_CHANGE</code> 권한이 있어야 수정할 수 있습니다.
          </span>
        </div>
      ) : null}

      <div className={styles.layoutGrid}>
        {/* 좌측: 역할 목록 사이드바 */}
        <aside className={styles.roleSidebar} aria-label="역할 목록">
          <div className={styles.sidebarHeader}>
            <span>워크스페이스 역할</span>
            {canManageRoles && !isCreatingRole ? (
              <button
                type="button"
                className={styles.addRoleBtn}
                onClick={() => startCreatingRole()}
                disabled={isSaving}
                title="이 워크스페이스에 새로운 역할을 추가합니다."
              >
                <Icon name="plus" size={13} />
                <span>역할 추가</span>
              </button>
            ) : null}
          </div>

          <div className={styles.roleList} role="region" aria-label="워크스페이스 역할 목록" tabIndex={0}>
            {/* 신규 역할 생성 진행 중 카드 */}
            {isCreatingRole ? (
              <div className={[styles.roleItem, styles.roleItemActive, styles.roleItemCreating].join(' ')}>
                <div className={styles.roleItemTop}>
                  <div className={styles.roleItemBadgeRow}>
                    <span className={styles.roleBadge} data-role="CUSTOM">
                      {newRoleName.trim() || '새 역할'}
                    </span>
                    <span className={styles.unsavedDot} title="생성 중 (미저장)" />
                  </div>
                </div>
                <div className={styles.roleMeta}>
                  <span>{activeCount} / {totalCount}개 권한 설정 중</span>
                </div>
              </div>
            ) : null}

            {allRoleNames.map((role) => {
              const isSelected = !isCreatingRole && selectedRole === role
              const savedMask = savedBitmaskMap.get(role) || getDefaultAuthority(role)
              const draftMask = draftBitmaskMap.get(role) || getDefaultAuthority(role)
              const hasUnsavedChanges = !isCreatingRole && savedMask !== draftMask

              const bSet = parseAuthorityBitSet(savedMask)
              const count = AUTHORITY_BITS.filter((b) => b.bit !== 23 && bSet.has(b.bit)).length

              return (
                <button
                  key={role}
                  type="button"
                  className={[styles.roleItem, isSelected ? styles.roleItemActive : ''].join(' ')}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (!canManageRoles || isSaving) return
                    setRoleMenu({ role, x: event.clientX, y: event.clientY })
                  }}
                  onClick={() => {
                    if (isCreatingRole) {
                      setIsCreatingRole(false)
                      setNewRoleName('')
                    }
                    setIsRenamingRole(false)
                    setEditRoleName('')
                    setSelectedRole(role)
                  }}
                >
                  <div className={styles.roleItemTop}>
                    <div className={styles.roleItemBadgeRow}>
                      <span
                        className={styles.roleBadge}
                        style={getRoleBadgeStyle(roleLabel(role), definitionById.get(role)?.isTopRole)}
                      >
                        {roleLabel(role)}
                      </span>
                      {hasUnsavedChanges ? (
                        <span className={styles.unsavedDot} title="수정 중 (미저장)" />
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.roleMeta}>
                    <span>
                      {count} / {totalCount}개 권한 보유
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </aside>

        {roleMenu && canManageRoles && definitionById.has(roleMenu.role) ? createPortal(
          <div
            ref={roleMenuRef}
            className={menuStyles.menu}
            style={{ left: roleMenu.x, top: roleMenu.y, maxWidth: 'calc(100vw - 16px)' }}
            role="menu"
            aria-label="역할 메뉴"
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              className={menuStyles.item}
              role="menuitem"
              disabled={isSaving}
              onClick={() => startCreatingRole(savedBitmaskMap.get(roleMenu.role) ?? getDefaultAuthority(roleMenu.role))}
            >
              <Icon name="plus" size={15} />
              <span style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{roleLabel(roleMenu.role)}의 권한으로 새로 만들기</span>
            </button>
          </div>,
          document.body,
        ) : null}

        {/* 우측: 상세 권한 매트릭스 */}
        <main className={styles.permissionMain} aria-label="세부 권한 설정">
          <header className={styles.mainHeader}>
            <div className={styles.mainHeaderLeft}>
              {isCreatingRole ? (
                <div className={styles.titleRow}>
                  <div className={styles.roleNameInputWrapper}>
                    <input
                      type="text"
                      className={styles.roleNameInput}
                      placeholder="새 역할 이름 (예: 디자이너, QA)"
                      value={newRoleName}
                      onChange={(e) => setNewRoleName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <span className={styles.creatingPill}>신규 역할 생성 모드</span>
                  <span className={styles.activePill}>
                    {activeCount} / {totalCount} 활성화
                  </span>
                </div>
              ) : (
                <div className={styles.titleRow}>
                  {isRenamingRole ? (
                    <div className={styles.roleRenameWrapper}>
                      <input
                        type="text"
                        className={styles.roleNameInput}
                        value={editRoleName}
                        onChange={(e) => setEditRoleName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRenameRole()
                          if (e.key === 'Escape') setIsRenamingRole(false)
                        }}
                        autoFocus
                      />
                      <button
                        type="button"
                        className={styles.renameActionBtn}
                        onClick={handleRenameRole}
                        disabled={isSaving}
                        title="이름 변경 저장 (Enter)"
                      >
                        <Icon name="checkCircle" size={14} />
                      </button>
                      <button
                        type="button"
                        className={styles.renameCancelBtn}
                        onClick={() => setIsRenamingRole(false)}
                        disabled={isSaving}
                        title="취소 (Esc)"
                      >
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className={styles.roleTitleWithEdit}>
                      <h2>{roleLabel(selectedRole)} 역할 세부 권한</h2>
                      {canManageRoles ? (
                        <button
                          type="button"
                          className={styles.editRoleNameBtn}
                          onClick={() => {
                            setEditRoleName(roleLabel(selectedRole))
                            setIsRenamingRole(true)
                          }}
                          title="역할 이름 변경"
                        >
                          <Icon name="gear" size={13} />
                          <span>이름 변경</span>
                        </button>
                      ) : null}
                    </div>
                  )}

                  <span className={styles.activePill}>
                    {activeCount} / {totalCount} 활성화
                  </span>
                  {isSelectedAdmin ? (
                    <span className={styles.systemPill}>
                      <Icon name="lock" size={12} />
                      시스템 불변 역할
                    </span>
                  ) : isDirty ? (
                    <span className={styles.dirtyPill}>수정 중 (미저장)</span>
                  ) : null}
                </div>
              )}
            </div>

            <div className={styles.mainHeaderRight}>
              {isSelectedAdmin ? (
                <div className={styles.adminLockNotice}>
                  <Icon name="checkCircle" size={14} />
                  <span>최상위 역할의 권한은 변경할 수 없습니다. 이름은 변경할 수 있습니다.</span>
                </div>
              ) : canManageRoles ? (
                <>
                  {/* 커스텀 프리셋 템플릿 드롭다운 */}
                  <div className={styles.presetDropdownWrapper} ref={presetDropdownRef}>
                    <button
                      type="button"
                      className={[styles.presetTriggerBtn, isPresetOpen ? styles.presetTriggerBtnActive : ''].join(' ')}
                      onClick={() => setIsPresetOpen((prev) => !prev)}
                      title="표준 권한 템플릿(프리셋)을 불러옵니다."
                    >
                      <Icon name="sparkles" size={13} className={styles.presetTriggerIcon} />
                      <span>프리셋 불러오기</span>
                      <Icon name="chevronDown" size={12} className={[styles.presetChevron, isPresetOpen ? styles.presetChevronOpen : ''].join(' ')} />
                    </button>

                    {isPresetOpen ? (
                      <div className={styles.presetMenu}>
                        <div className={styles.presetMenuHeader}>표준 권한 템플릿</div>
                        {AUTHORITY_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className={styles.presetMenuItem}
                            onClick={() => {
                              handleApplyPreset(p)
                              setIsPresetOpen(false)
                            }}
                          >
                            <div className={styles.presetItemTitle}>{p.label}</div>
                            <div className={styles.presetItemDesc}>{p.description}</div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {/* 수정 취소 / 생성 취소 버튼 */}
                  <Button
                    variant="secondary"
                    onClick={handleRevertChanges}
                    disabled={isSaving || (!isCreatingRole && !isDirty)}
                    className={styles.resetBtn}
                    title={isCreatingRole ? '역할 생성을 취소합니다.' : '저장되지 않은 변경사항을 취소하고 원래 상태로 되돌립니다.'}
                  >
                    {isCreatingRole ? '생성 취소' : '수정 취소'}
                  </Button>

                  {/* 변경사항 저장 / 역할 생성 저장 버튼 */}
                  <Button
                    variant="primary"
                    onClick={handleOpenSaveConfirm}
                    disabled={isSaving || (!isCreatingRole && !isDirty)}
                  >
                    {isSaving
                      ? (isCreatingRole ? '생성 중...' : '저장 중...')
                      : saveSuccess
                      ? (isCreatingRole ? '생성 완료!' : '저장 완료!')
                      : (isCreatingRole ? '역할 생성 저장' : '변경사항 저장')}
                  </Button>
                </>
              ) : null}
            </div>
          </header>

          {/* 도메인 카테고리별 2열 레이아웃 */}
          <div className={styles.groupGrid} role="region" aria-label="세부 권한 목록" tabIndex={0}>
            {/* 좌측 열 */}
            <div className={styles.gridColumn}>
              {leftGroups.map((group) => renderGroupCard(group))}
            </div>

            {/* 우측 열 */}
            <div className={styles.gridColumn}>
              {rightGroups.map((group) => renderGroupCard(group))}
            </div>
          </div>
        </main>
      </div>

      {/* 저장 전 Before vs After 비교 확인 모달 */}
      <RoleSaveConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={handleConfirmSave}
        roleName={isCreatingRole ? newRoleName.trim() || '새 역할' : roleLabel(selectedRole)}
        savedBitmask={savedBitmaskStr}
        draftBitmask={currentBitmaskStr}
        isSaving={isSaving}
        isDisablingOwnRoleChange={!isCreatingRole && isDisablingOwnRoleChange}
        isCreating={isCreatingRole}
      />

      {/* 모던 알림/에러 모달 */}
      <ToastAlertModal
        isOpen={alertInfo.isOpen}
        onClose={() => setAlertInfo((prev) => ({ ...prev, isOpen: false }))}
        title={alertInfo.title}
        message={alertInfo.message}
        type={alertInfo.type}
      />
    </div>
  )
}
