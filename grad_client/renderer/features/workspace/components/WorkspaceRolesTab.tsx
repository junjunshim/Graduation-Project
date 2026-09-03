import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  AUTHORITY_BITS,
  AUTHORITY_PRESETS,
  DEFAULT_ROLE_AUTHORITIES,
  getCascadeImpact,
  parseAuthorityBitSet,
  stringifyAuthorityBitSet,
  toggleAuthorityBit,
  type AuthorityBitInfo,
  type AuthorityPreset,
} from '../model/authorityDefinitions'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleName,
  UserRecord,
} from '../model/types'
import { RoleSaveConfirmModal } from './RoleSaveConfirmModal'
import styles from './WorkspaceRolesTab.module.css'

type WorkspaceRolesTabProps = {
  rootNode?: OrganizationNodeRecord | null
  authorities?: AuthorityRecord[]
  roles?: RoleAssignmentRecord[]
  currentUserId?: string
  currentUser?: UserRecord | null
}

const PRESET_ROLES: RoleName[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']

export function WorkspaceRolesTab({
  rootNode,
  authorities = [],
  roles = [],
  currentUserId,
}: WorkspaceRolesTabProps) {
  const [selectedRole, setSelectedRole] = useState<RoleName>('MANAGER')
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [isPresetOpen, setIsPresetOpen] = useState(false)
  const presetDropdownRef = useRef<HTMLDivElement>(null)

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

  // 현재 노드 기준 역할별 권한 매핑
  const roleBitmaskMap = useMemo(() => {
    const map = new Map<RoleName, string>()
    PRESET_ROLES.forEach((r) => map.set(r, DEFAULT_ROLE_AUTHORITIES[r]))

    authorities
      .filter((a) => !rootNode || a.nodeId === rootNode.id)
      .forEach((a) => map.set(a.roleName, a.authority))

    return map
  }, [authorities, rootNode])

  // 실제 저장된(반영된) 권한 상태
  const [savedBitmaskMap, setSavedBitmaskMap] = useState<Map<RoleName, string>>(
    () => new Map(roleBitmaskMap),
  )

  // 현재 편집 중(Draft)인 권한 상태
  const [draftBitmaskMap, setDraftBitmaskMap] = useState<Map<RoleName, string>>(
    () => new Map(roleBitmaskMap),
  )

  const currentBitmaskStr = draftBitmaskMap.get(selectedRole) || DEFAULT_ROLE_AUTHORITIES[selectedRole]
  const savedBitmaskStr = savedBitmaskMap.get(selectedRole) || DEFAULT_ROLE_AUTHORITIES[selectedRole]
  const isDirty = currentBitmaskStr !== savedBitmaskStr

  const currentBitSet = useMemo(() => parseAuthorityBitSet(currentBitmaskStr), [currentBitmaskStr])
  const savedBitSet = useMemo(() => parseAuthorityBitSet(savedBitmaskStr), [savedBitmaskStr])

  // 현재 로그인한 사용자의 직속 역할 확인
  const currentUserRole = useMemo(() => {
    if (!currentUserId || !rootNode) return null
    const myRole = roles.find((r) => !r.isDeleted && r.nodeId === rootNode.id && r.userId === currentUserId)
    return myRole?.roleName || null
  }, [currentUserId, roles, rootNode])

  const isCurrentUserAdmin = currentUserRole === 'ADMIN'

  // 현재 사용자가 권한 변경 권한(ROLE_CHANGE, Bit 15 또는 ADMIN)을 가졌는지 검사
  const canManageRoles = useMemo(() => {
    if (!currentUserId || !rootNode || !currentUserRole) return false
    if (currentUserRole === 'ADMIN') return true

    const myBitmask = savedBitmaskMap.get(currentUserRole) || DEFAULT_ROLE_AUTHORITIES[currentUserRole]
    const myBitSet = parseAuthorityBitSet(myBitmask)
    return myBitSet.has(15) // Bit 15: ROLE_CHANGE
  }, [currentUserId, currentUserRole, rootNode, savedBitmaskMap])

  const isSelectedAdmin = selectedRole === 'ADMIN'
  const isEditable = canManageRoles && !isSelectedAdmin

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
    // DENY(Bit 23)는 최고 관리자(ADMIN)만 수정 가능
    if (bit === 23 && !isCurrentUserAdmin) {
      return
    }

    const isCurrentlyOn = currentBitSet.has(bit)
    const targetValue = !isCurrentlyOn
    const nextSet = toggleAuthorityBit(currentBitSet, bit, targetValue)
    const nextBitmaskStr = stringifyAuthorityBitSet(nextSet)

    setDraftBitmaskMap((prev) => {
      const nextMap = new Map(prev)
      nextMap.set(selectedRole, nextBitmaskStr)
      return nextMap
    })
    setSaveSuccess(false)
  }

  // 수정 취소 (원래 저장 상태로 되돌리기)
  const handleRevertChanges = () => {
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
    setDraftBitmaskMap((prev) => {
      const nextMap = new Map(prev)
      nextMap.set(selectedRole, bitmask)
      return nextMap
    })
    setSaveSuccess(false)
  }

  // 변경사항 저장 모달 열기
  const handleOpenSaveConfirm = () => {
    if (!isEditable || !isDirty) return
    setIsConfirmModalOpen(true)
  }

  // 최종 저장 확정 처리
  const handleConfirmSave = async () => {
    setIsSaving(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, 500))
      setSavedBitmaskMap(new Map(draftBitmaskMap))
      setSaveSuccess(true)
      setIsConfirmModalOpen(false)
      setTimeout(() => setSaveSuccess(false), 3000)
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
                      <span className={styles.adminOnlyBadge} title="최고 관리자(ADMIN)만 수정할 수 있습니다.">
                        <Icon name="lock" size={10} />
                        ADMIN 전용
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
          <Icon name="lock" size={18} className={styles.readonlyIcon} />
          <div>
            <strong>읽기 전용 모드 (조회만 가능)</strong>
            <p>
              현재 워크스페이스에서 역할 권한 변경 권한(<code>ROLE_CHANGE</code> 또는 <code>ADMIN</code>)이 없어 권한을 수정할 수 없습니다.
            </p>
          </div>
        </div>
      ) : null}

      <div className={styles.layoutGrid}>
        {/* 좌측: 역할 목록 사이드바 */}
        <aside className={styles.roleSidebar} aria-label="역할 목록">
          <div className={styles.sidebarHeader}>
            <span>워크스페이스 역할</span>
          </div>

          <div className={styles.roleList}>
            {PRESET_ROLES.map((role) => {
              const isSelected = selectedRole === role
              const savedMask = savedBitmaskMap.get(role) || DEFAULT_ROLE_AUTHORITIES[role]
              const draftMask = draftBitmaskMap.get(role) || DEFAULT_ROLE_AUTHORITIES[role]
              const hasUnsavedChanges = savedMask !== draftMask

              const bSet = parseAuthorityBitSet(savedMask)
              const count = AUTHORITY_BITS.filter((b) => b.bit !== 23 && bSet.has(b.bit)).length

              return (
                <button
                  key={role}
                  type="button"
                  className={[styles.roleItem, isSelected ? styles.roleItemActive : ''].join(' ')}
                  onClick={() => {
                    setSelectedRole(role)
                  }}
                >
                  <div className={styles.roleItemTop}>
                    <div className={styles.roleItemBadgeRow}>
                      <span className={styles.roleBadge} data-role={role}>
                        {role}
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

        {/* 우측: 상세 권한 매트릭스 */}
        <main className={styles.permissionMain} aria-label="세부 권한 설정">
          <header className={styles.mainHeader}>
            <div className={styles.mainHeaderLeft}>
              <div className={styles.titleRow}>
                <h2>{selectedRole} 역할 세부 권한</h2>
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
            </div>

            <div className={styles.mainHeaderRight}>
              {isSelectedAdmin ? (
                <div className={styles.adminLockNotice}>
                  <Icon name="checkCircle" size={14} />
                  <span>ADMIN은 모든 시스템 권한을 영구 보유합니다.</span>
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

                  {/* 수정 취소 (되돌리기) 버튼 */}
                  <Button
                    variant="secondary"
                    onClick={handleRevertChanges}
                    disabled={isSaving || !isDirty}
                    className={styles.resetBtn}
                    title="저장되지 않은 변경사항을 취소하고 원래 상태로 되돌립니다."
                  >
                    수정 취소
                  </Button>

                  {/* 변경사항 저장 버튼 */}
                  <Button
                    variant="primary"
                    onClick={handleOpenSaveConfirm}
                    disabled={isSaving || !isDirty}
                  >
                    {isSaving ? '저장 중...' : saveSuccess ? '저장 완료!' : '변경사항 저장'}
                  </Button>
                </>
              ) : null}
            </div>
          </header>

          {/* 도메인 카테고리별 2열 레이아웃 */}
          <div className={styles.groupGrid}>
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
        roleName={selectedRole}
        savedBitmask={savedBitmaskStr}
        draftBitmask={currentBitmaskStr}
        isSaving={isSaving}
        isDisablingOwnRoleChange={isDisablingOwnRoleChange}
      />
    </div>
  )
}


