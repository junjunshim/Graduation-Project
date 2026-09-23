import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getRoleBadgeStyle } from '../model/labels'
import {
  assignRoleOnServer,
  fetchRoleRemovalPreviewOnServer,
  removeRoleOnServer,
  updateRoleOnServer,
} from '../data/server/serverWorkspace'
import { canManageNodeRoles } from '../model/effectiveAuthority'
import {
  analyzeWorkspaceMembers,
  buildRoleBitmaskMap,
  getRolePriorityScore,
  type WorkspaceMemberDetail,
} from '../model/memberInheritance'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleMember,
  RoleName,
  RoleRemovalPreview,
  UserRecord,
} from '../model/types'
import { AddMemberModal } from './AddMemberModal'
import {
  MemberRoleSettingsModal,
  type MemberRoleSettingsSubmitResult,
} from './MemberRoleSettingsModal'
import { ToastAlertModal, type AlertType } from '../../../design-system/primitives/ToastAlertModal'
import styles from './WorkspaceMembersTab.module.css'

export type MemberSegmentType = 'all' | 'direct' | 'inherited' | 'overridden'
export type { WorkspaceMemberDetail }

type WorkspaceMembersTabProps = {
  rootNode?: OrganizationNodeRecord | null
  currentUserId?: string
  nodes?: OrganizationNodeRecord[]
  roles?: RoleAssignmentRecord[]
  users?: UserRecord[]
  authorities?: AuthorityRecord[]
  rootRoleMembers?: RoleMember[]
  allRoleMembers?: RoleMember[]
}

export function WorkspaceMembersTab({
  rootNode,
  currentUserId,
  nodes = [],
  roles = [],
  users = [],
  authorities = [],
}: WorkspaceMembersTabProps) {
  const [activeSegment, setActiveSegment] = useState<MemberSegmentType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleName>('all')
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false)
  const roleDropdownRef = useRef<HTMLDivElement>(null)

  // 페이징 상태 (10명 고정)
  const [currentPage, setCurrentPage] = useState(1)
  const PAGE_SIZE = 10

  // 사용자 추가 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [isAddingMember, setIsAddingMember] = useState(false)

  // 역할 설정(변경/회수) 모달 상태
  const [settingsMember, setSettingsMember] = useState<WorkspaceMemberDetail | null>(null)
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false)

  // 상속 멤버 권한 오버라이드 모달 상태
  const [overrideMember, setOverrideMember] = useState<WorkspaceMemberDetail | null>(null)

  // 모던 알림/에러 모달 상태
  const [alertInfo, setAlertInfo] = useState<{ isOpen: boolean; message: string; title?: string; type?: AlertType }>({
    isOpen: false,
    message: '',
  })
  const showAlert = (message: string, title?: string, type: AlertType = 'error') => {
    setAlertInfo({ isOpen: true, message, title, type })
  }

  const roleNameOf = (roleId: number) => authorities.find((a) => a.id === roleId)?.roleName ?? ''

  // 서버가 실패를 반환하면 로컬 캐시를 건드리지 않는다. (성공 시에만 재조회가 일어난다)
  const runMemberMutation = async (
    operation: () => Promise<{ status: 'success' } | { status: 'error'; message: string }>,
    fallbackMessage: string,
  ): Promise<MemberRoleSettingsSubmitResult> => {
    try {
      const result = await operation()
      if (result.status === 'error') {
        return { ok: false, message: result.message || fallbackMessage }
      }
      return { ok: true }
    } catch (err) {
      console.error('[WorkspaceMembersTab] 멤버 역할 변경 실패:', err)
      return { ok: false, message: '서버 통신 중 오류가 발생했습니다.' }
    }
  }

  // 사용자 추가 확정 핸들러 (상속 멤버 권한 오버라이드도 동일하게 동작한다)
  const handleAddMember = async (targetEmail: string, targetRole: number) => {
    if (!rootNode) return
    const isOverride = Boolean(overrideMember)
    setIsAddingMember(true)
    try {
      const result = await assignRoleOnServer({
        nodeId: rootNode.id,
        email: targetEmail,
        roleId: targetRole,
        roleName: roleNameOf(targetRole),
      })

      if (result.status === 'error') {
        showAlert(result.message || '사용자 추가에 실패했습니다.', '사용자 추가 실패', 'error')
        return
      }

      setIsAddModalOpen(false)
      setOverrideMember(null)
      showAlert(
        isOverride
          ? `${overrideMember?.name ?? targetEmail}님에게 ${roleNameOf(targetRole)} 역할을 이 공간에서 직접 지정했습니다.`
          : `${targetEmail} 사용자를 ${roleNameOf(targetRole)} 역할로 추가했습니다.`,
        isOverride ? '권한 오버라이드 완료' : '추가 완료',
        'success',
      )
    } catch (err) {
      console.error('[WorkspaceMembersTab] 사용자 추가 실패:', err)
      showAlert('서버 통신 중 오류가 발생했습니다.', '통신 오류', 'error')
    } finally {
      setIsAddingMember(false)
    }
  }

  // 역할 변경
  const handleUpdateMemberRole = async (roleId: number): Promise<MemberRoleSettingsSubmitResult> => {
    const member = settingsMember
    if (!rootNode || !member || !member.email) {
      return { ok: false, message: '역할을 변경할 사용자 정보를 찾을 수 없습니다.' }
    }

    setIsSubmittingSettings(true)
    const result = await runMemberMutation(
      () =>
        updateRoleOnServer({
          nodeId: rootNode.id,
          email: member.email,
          roleId,
          roleName: roleNameOf(roleId),
        }),
      '역할 변경에 실패했습니다.',
    )
    setIsSubmittingSettings(false)

    if (result.ok) {
      showAlert(`${member.name}님의 역할을 ${roleNameOf(roleId)}(으)로 변경했습니다.`, '역할 변경 완료', 'success')
    }
    return result
  }

  // 역할 회수 전 이관 정보 조회
  const loadMemberRemovalPreview = async (): Promise<
    MemberRoleSettingsSubmitResult & { preview?: RoleRemovalPreview }
  > => {
    const member = settingsMember
    if (!rootNode || !member || !member.email) {
      return { ok: false, message: '역할을 회수할 사용자 정보를 찾을 수 없습니다.' }
    }

    const result = await fetchRoleRemovalPreviewOnServer(member.email, rootNode.id)
    return result.status === 'error'
      ? { ok: false, message: result.message || '역할 회수 정보를 불러오지 못했습니다.' }
      : { ok: true, preview: result.preview }
  }

  // 역할 회수 (미완료 업무는 지정한 담당자에게 이관)
  const handleRemoveMemberRole = async (
    newOwnerEmail?: string,
  ): Promise<MemberRoleSettingsSubmitResult> => {
    const member = settingsMember
    if (!rootNode || !member || !member.email) {
      return { ok: false, message: '역할을 회수할 사용자 정보를 찾을 수 없습니다.' }
    }

    setIsSubmittingSettings(true)
    let transferSummary = ''
    const result = await runMemberMutation(async () => {
      const response = await removeRoleOnServer({
        nodeId: rootNode.id,
        email: member.email,
        newOwnerEmail,
      })

      if (response.status === 'success' && response.result.transferredWorkItemCount > 0) {
        transferSummary = `미완료 업무 ${response.result.transferredWorkItemCount}건을 ${
          response.result.transferTargetName ?? '새 담당자'
        }님에게 이관했습니다.`
      }
      return response
    }, '역할 회수에 실패했습니다.')
    setIsSubmittingSettings(false)

    if (result.ok) {
      showAlert(
        `${member.name}님의 역할을 회수했습니다.${transferSummary ? ' ' + transferSummary : ''}`,
        '역할 회수 완료',
        'success',
      )
    }
    return result
  }

  // 필터나 검색어, 세그먼트가 변경되면 1페이지로 리셋
  useEffect(() => {
    setCurrentPage(1)
  }, [activeSegment, searchQuery, roleFilter])

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target as Node)) {
        setIsRoleDropdownOpen(false)
      }
    }
    if (isRoleDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isRoleDropdownOpen])

  // 역할 우선순위 점수 계산 함수 (서열 기반)
  const roleBitmaskMap = useMemo(
    () => buildRoleBitmaskMap(authorities, rootNode),
    [authorities, rootNode],
  )

  const getRolePriority = useMemo(() => {
    return (role: string): number => getRolePriorityScore(role, roleBitmaskMap)
  }, [roleBitmaskMap])

  const availableRoles = useMemo(() => authorities.filter((a) => !rootNode || a.nodeId === rootNode.id)
    .sort((a, b) => Number(Boolean(b.isTopRole)) - Number(Boolean(a.isTopRole)) || getRolePriority(String(b.id)) - getRolePriority(String(a.id))), [authorities, rootNode, getRolePriority])
  const assignableRoles = useMemo(() => availableRoles.filter((a) => !a.isTopRole), [availableRoles])
  const changeableRoles = useMemo(
    () => assignableRoles.filter((a) => String(a.id) !== String(settingsMember?.effectiveRoleId ?? '')),
    [assignableRoles, settingsMember],
  )
  const roleLabel = (id: string) => authorities.find((a) => String(a.id) === id)?.roleName ?? '역할 정보 없음'

  // 멤버 역할 부여/변경/회수는 해당 노드에 `직속`으로 NODE_ADD_ROLE 을 가진 사용자만 가능하다.
  const canManageMembers = useMemo(
    () => Boolean(rootNode && currentUserId && canManageNodeRoles(currentUserId, rootNode.id, { roles, authorities })),
    [authorities, currentUserId, roles, rootNode],
  )

  // 전체 멤버들의 상속 및 오버라이드 상태 분석
  const {
    all: memberDetails,
    direct: directMembers,
    inherited: inheritedMembers,
    overridden: overriddenMembers,
  } = useMemo(
    () =>
      analyzeWorkspaceMembers({
        rootNode,
        nodes,
        roles,
        users,
        authorities,
      }),
    [authorities, nodes, roles, rootNode, users],
  )

  // 현재 활성 세그먼트 데이터
  const segmentItems = useMemo(() => {
    if (activeSegment === 'direct') return directMembers
    if (activeSegment === 'inherited') return inheritedMembers
    if (activeSegment === 'overridden') return overriddenMembers
    return memberDetails
  }, [activeSegment, directMembers, inheritedMembers, memberDetails, overriddenMembers])

  // 검색 및 역할 필터링
  const filteredItems = useMemo(() => {
    let list = segmentItems

    if (roleFilter !== 'all') {
      list = list.filter((m) => String(m.effectiveRoleId) === roleFilter)
    }

    const query = searchQuery.trim().toLowerCase()
    if (query) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.email.toLowerCase().includes(query) ||
          m.userId.toLowerCase().includes(query),
      )
    }

    return list
  }, [roleFilter, searchQuery, segmentItems])

  // 페이징 계산 (10명 고정)
  const totalItems = filteredItems.length
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const safeCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * PAGE_SIZE
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalItems)
  const paginatedItems = useMemo(
    () => filteredItems.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredItems, startIndex],
  )

  return (
    <div className={styles.container}>
      {/* 상단 툴바: 세그먼트 탭 & 검색 / 필터 */}
      <div className={styles.toolbar}>
        <div className={styles.segmentGroup} role="tablist" aria-label="사용자 분류">
          <button
            type="button"
            role="tab"
            aria-selected={activeSegment === 'all'}
            className={[styles.segmentBtn, activeSegment === 'all' ? styles.segmentBtnActive : ''].join(' ')}
            onClick={() => setActiveSegment('all')}
          >
            <Icon name="users" size={16} />
            <span>전체 사용자</span>
            <span className={styles.segmentCount}>{memberDetails.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSegment === 'direct'}
            className={[styles.segmentBtn, activeSegment === 'direct' ? styles.segmentBtnActive : ''].join(' ')}
            onClick={() => setActiveSegment('direct')}
          >
            <Icon name="user" size={16} />
            <span>직속 멤버</span>
            <span className={styles.segmentCount}>{directMembers.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSegment === 'inherited'}
            className={[styles.segmentBtn, activeSegment === 'inherited' ? styles.segmentBtnActive : ''].join(' ')}
            onClick={() => setActiveSegment('inherited')}
          >
            <Icon name="orgChart" size={16} />
            <span>상속된 멤버</span>
            <span className={styles.segmentCount}>{inheritedMembers.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeSegment === 'overridden'}
            className={[styles.segmentBtn, activeSegment === 'overridden' ? styles.segmentBtnActive : ''].join(' ')}
            onClick={() => setActiveSegment('overridden')}
          >
            <Icon name="sparkles" size={16} />
            <span>오버라이드된 사용자</span>
            <span className={styles.segmentCount}>{overriddenMembers.length}</span>
          </button>
        </div>

        <div className={styles.toolbarRight}>
          <SearchField
            label="사용자 검색"
            placeholder="이름, 이메일, ID 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName={styles.searchBox}
          />

          {/* 커스텀 역할 필터 드롭다운 */}
          <div className={styles.roleDropdownWrapper} ref={roleDropdownRef}>
            <button
              type="button"
              className={[styles.roleTriggerBtn, isRoleDropdownOpen ? styles.roleTriggerBtnActive : ''].join(' ')}
              onClick={() => setIsRoleDropdownOpen((prev) => !prev)}
              aria-label="역할 필터"
            >
              <span className={styles.roleTriggerLabel}>
                {roleFilter === 'all' ? '모든 역할' : roleLabel(roleFilter)}
              </span>
              <span className={styles.roleTriggerCount}>
                {roleFilter === 'all'
                  ? memberDetails.length
                  : memberDetails.filter((m) => String(m.effectiveRoleId) === roleFilter).length}
              </span>
              <Icon
                name="chevronDown"
                size={12}
                className={[styles.roleChevron, isRoleDropdownOpen ? styles.roleChevronOpen : ''].join(' ')}
              />
            </button>

            {isRoleDropdownOpen ? (
              <div className={styles.roleDropdownMenu}>
                <div className={styles.roleDropdownHeader}>역할별 필터</div>
                <button
                  type="button"
                  className={[
                    styles.roleDropdownItem,
                    roleFilter === 'all' ? styles.roleDropdownItemActive : '',
                  ].join(' ')}
                  onClick={() => {
                    setRoleFilter('all')
                    setIsRoleDropdownOpen(false)
                  }}
                >
                  <span className={styles.roleItemName}>모든 역할</span>
                  <span className={styles.roleItemCount}>{memberDetails.length}</span>
                </button>

                {availableRoles.map((definition) => {
                  const role = String(definition.id)
                  const count = memberDetails.filter((m) => String(m.effectiveRoleId) === role).length
                  const isSelected = roleFilter === role

                  return (
                    <button
                      key={role}
                      type="button"
                      className={[
                        styles.roleDropdownItem,
                        isSelected ? styles.roleDropdownItemActive : '',
                      ].join(' ')}
                      onClick={() => {
                        setRoleFilter(role)
                        setIsRoleDropdownOpen(false)
                      }}
                    >
                      <span
                        className={styles.roleBadgeSmall}
                        style={getRoleBadgeStyle(roleLabel(role), definition.isTopRole)}
                      >
                        {roleLabel(role)}
                      </span>
                      <span className={styles.roleItemCount}>{count}명</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          {/* 사용자 추가 버튼 (직속 관리 권한 보유 시에만 노출) */}
          {canManageMembers ? (
            <button
              type="button"
              className={styles.addMemberBtn}
              onClick={() => setIsAddModalOpen(true)}
            >
              <Icon name="plus" size={14} />
              <span>사용자 추가</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* 안내 배너 (오버라이드 탭 선택 시) */}
      {activeSegment === 'overridden' ? (
        <div className={styles.overrideBanner}>
          <Icon name="helpCircle" size={18} className={styles.bannerIcon} />
          <div>
            <strong>권한 오버라이드(Override) 정책 안내</strong>
            <p>
              상위 워크스페이스의 기본 권한보다 우선하여, 이 공간에서 별도로 승격되거나 개별 지정된 권한을 가진 사용자 목록입니다.
            </p>
          </div>
        </div>
      ) : null}

      {/* 사용자 목록 테이블 카드 */}
      <div className={styles.tableCard}>
        <div className={styles.tableResponsive}>
          <table className={styles.memberTable}>
            <thead>
              <tr>
                <th className={styles.thUser}>사용자</th>
                <th className={styles.thRole}>역할 (Role)</th>
                <th className={styles.thType}>소속 형태</th>
                <th className={styles.thOverride}>상속 / 오버라이드 내역</th>
                <th className={styles.thAction}>관리</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyCell}>
                    <Icon name="users" size={28} />
                    <p>해당 조건에 일치하는 사용자가 없습니다.</p>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((member) => (
                  <tr key={member.userId} className={styles.memberRow}>
                    {/* 사용자 프로필 */}
                    <td className={styles.tdUser}>
                      <div className={styles.userProfile}>
                        <UserAvatar name={member.name} userId={member.userId} size="medium" />
                        <div className={styles.userInfo}>
                          <strong className={styles.userName}>{member.name}</strong>
                          <span className={styles.userEmail}>{member.email || member.userId}</span>
                        </div>
                      </div>
                    </td>

                    {/* 역할 뱃지 */}
                    <td className={styles.tdRole}>
                      <span
                        className={styles.roleBadge}
                        style={getRoleBadgeStyle(member.effectiveRoleName, member.isTopRole)}
                      >
                        {member.effectiveRoleName}
                      </span>
                    </td>

                    {/* 소속 형태 */}
                    <td className={styles.tdType}>
                      {member.isDirect ? (
                        <span className={styles.directBadge}>직속 멤버</span>
                      ) : (
                        <span className={styles.inheritedBadge}>
                          상속: {member.sourceNodeName}
                        </span>
                      )}
                    </td>

                    {/* 상속 / 오버라이드 내역 */}
                    <td className={styles.tdOverride}>
                      {member.isOverridden ? (
                        <div className={styles.overrideDetail}>
                          <span className={styles.overrideTag}>OVERRIDE</span>
                          <span className={styles.overrideText}>{member.overrideReason}</span>
                        </div>
                      ) : (
                        <span className={styles.normalText}>기본 정책 적용</span>
                      )}
                    </td>

                    {/* 액션 */}
                    <td className={styles.tdAction}>
                      {!canManageMembers ? (
                        <span className={styles.actionHint}>-</span>
                      ) : member.isTopRole ? (
                        <span className={styles.actionHint}>최상위 담당자</span>
                      ) : member.isDirect ? (
                        member.userId === currentUserId ? (
                          <span className={styles.actionHint}>본인</span>
                        ) : (
                          <Button
                            variant="secondary"
                            className={styles.actionBtn}
                            onClick={() => setSettingsMember(member)}
                          >
                            <Icon name="gear" size={13} />
                            <span>설정</span>
                          </Button>
                        )
                      ) : (
                        <Button
                          variant="secondary"
                          className={styles.actionBtn}
                          onClick={() => setOverrideMember(member)}
                          title="상위 공간의 역할 대신 이 공간에 직접 역할을 지정합니다."
                        >
                          <Icon name="sparkles" size={13} />
                          <span>권한 오버라이드</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 테이블 하단: 페이징 네비게이션 */}
        {totalItems > 0 ? (
          <footer className={styles.paginationFooter}>
            <div className={styles.paginationInfo}>
              <span>
                총 <strong>{totalItems}</strong>명 중 <strong>{startIndex + 1}</strong> - <strong>{endIndex}</strong>명 표시 (페이지당 10명)
              </span>
            </div>

            <div className={styles.paginationNav}>
              {/* 첫 페이지 버튼 */}
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setCurrentPage(1)}
                disabled={safeCurrentPage <= 1}
                title="첫 페이지"
              >
                <Icon name="firstPage" size={14} />
              </button>

              {/* 이전 페이지 버튼 */}
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={safeCurrentPage <= 1}
                title="이전 페이지"
              >
                <Icon name="chevronLeft" size={14} />
              </button>

              {/* 페이지 번호 목록 */}
              <div className={styles.pageNumberGroup}>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    // 현재 페이지 주변 2개 및 처음/끝 페이지만 노출
                    return p === 1 || p === totalPages || Math.abs(p - safeCurrentPage) <= 1
                  })
                  .reduce<number[]>((acc, p) => {
                    if (acc.length > 0 && p - acc[acc.length - 1] > 1) {
                      acc.push(-1) // ellipsis 마커
                    }
                    acc.push(p)
                    return acc
                  }, [])
                  .map((p, idx) => {
                    if (p === -1) {
                      return (
                        <span key={`ellipsis-${idx}`} className={styles.pageEllipsis}>
                          …
                        </span>
                      )
                    }
                    const isActive = p === safeCurrentPage
                    return (
                      <button
                        key={p}
                        type="button"
                        className={[styles.pageNumberBtn, isActive ? styles.pageNumberBtnActive : ''].join(' ')}
                        onClick={() => setCurrentPage(p)}
                      >
                        {p}
                      </button>
                    )
                  })}
              </div>

              {/* 다음 페이지 버튼 */}
              <button
                type="button"
                className={styles.pageBtn}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={safeCurrentPage >= totalPages}
                title="다음 페이지"
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </div>
          </footer>
        ) : null}
      </div>

      {/* 사용자 추가 모달 */}
      <AddMemberModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onConfirm={handleAddMember}
        availableRoles={assignableRoles}
        isSubmitting={isAddingMember}
      />

      {/* 상속 멤버 권한 오버라이드 모달 (사용자 역할 추가와 동일한 동작) */}
      <AddMemberModal
        isOpen={Boolean(overrideMember)}
        onClose={() => setOverrideMember(null)}
        onConfirm={handleAddMember}
        availableRoles={assignableRoles}
        isSubmitting={isAddingMember}
        presetEmail={overrideMember?.email}
        title="권한 오버라이드"
        submitLabel="오버라이드 적용"
        hint={`${overrideMember?.name ?? ''}님은 상위 공간에서 ${overrideMember?.effectiveRoleName ?? '역할'} 권한을 상속받고 있습니다. 이 공간에 직접 역할을 지정하면 상속 대신 새 역할이 적용됩니다.`}
      />

      {/* 멤버 역할 설정(변경/회수) 모달 */}
      <MemberRoleSettingsModal
        isOpen={Boolean(settingsMember)}
        onClose={() => setSettingsMember(null)}
        userId={settingsMember?.userId ?? ''}
        userName={settingsMember?.name ?? ''}
        userEmail={settingsMember?.email ?? ''}
        nodeName={rootNode?.name ?? ''}
        currentRoleName={settingsMember?.effectiveRoleName ?? ''}
        assignableRoles={changeableRoles}
        isSubmitting={isSubmittingSettings}
        loadRemovalPreview={loadMemberRemovalPreview}
        onSubmitRoleChange={handleUpdateMemberRole}
        onSubmitRemoval={handleRemoveMemberRole}
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
