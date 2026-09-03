import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import {
  AUTHORITY_BITS,
  DEFAULT_ROLE_AUTHORITIES,
  parseAuthorityBitSet,
} from '../model/authorityDefinitions'
import { getRoleBadgeStyle } from '../model/labels'
import { assignRoleOnServer } from '../data/server/serverWorkspace'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleMember,
  RoleName,
  StandardRoleName,
  UserRecord,
} from '../model/types'
import { AddMemberModal } from './AddMemberModal'
import { ToastAlertModal, type AlertType } from '../../../design-system/primitives/ToastAlertModal'
import styles from './WorkspaceMembersTab.module.css'

export type MemberSegmentType = 'all' | 'direct' | 'overridden'

export type WorkspaceMemberDetail = {
  userId: string
  name: string
  email: string
  effectiveRoleName: RoleName
  directRoleName?: RoleName
  inheritedRoleName?: RoleName
  isDirect: boolean
  isOverridden: boolean
  sourceNodeName?: string
  overrideReason?: string
  assignedNodeId: number
}

type WorkspaceMembersTabProps = {
  rootNode?: OrganizationNodeRecord | null
  nodes?: OrganizationNodeRecord[]
  roles?: RoleAssignmentRecord[]
  users?: UserRecord[]
  authorities?: AuthorityRecord[]
  rootRoleMembers?: RoleMember[]
  allRoleMembers?: RoleMember[]
}

const PRESET_ROLES: StandardRoleName[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']

export function WorkspaceMembersTab({
  rootNode,
  nodes = [],
  roles = [],
  users = [],
  authorities = [],
  allRoleMembers = [],
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

  // 모던 알림/에러 모달 상태
  const [alertInfo, setAlertInfo] = useState<{ isOpen: boolean; message: string; title?: string; type?: AlertType }>({
    isOpen: false,
    message: '',
  })
  const showAlert = (message: string, title?: string, type: AlertType = 'error') => {
    setAlertInfo({ isOpen: true, message, title, type })
  }

  // 사용자 추가 확정 핸들러
  const handleAddMember = async (targetEmail: string, targetRole: RoleName) => {
    if (!rootNode) return
    setIsAddingMember(true)
    try {
      const result = await assignRoleOnServer({
        nodeId: rootNode.id,
        email: targetEmail,
        roleName: targetRole,
      })

      if (result.status === 'error') {
        showAlert(result.message || '사용자 추가에 실패했습니다.', '사용자 추가 실패', 'error')
        return
      }

      setIsAddModalOpen(false)
      showAlert(`${targetEmail} 사용자를 ${targetRole} 역할로 추가했습니다.`, '추가 완료', 'success')
    } catch (err) {
      console.error('[WorkspaceMembersTab] 사용자 추가 실패:', err)
      showAlert('서버 통신 중 오류가 발생했습니다.', '통신 오류', 'error')
    } finally {
      setIsAddingMember(false)
    }
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

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const usersById = useMemo(() => new Map(users.map((u) => [u.userId, u])), [users])

  // 현재 노드 기준 역할별 권한 비트맵 (DB authorities 기준)
  const roleBitmaskMap = useMemo(() => {
    const map = new Map<RoleName, string>()
    const nodeAuthorities = authorities.filter((a) => !rootNode || a.nodeId === rootNode.id)

    if (nodeAuthorities.length === 0) {
      PRESET_ROLES.forEach((r) => map.set(r, DEFAULT_ROLE_AUTHORITIES[r]))
    } else {
      map.set('ADMIN', DEFAULT_ROLE_AUTHORITIES.ADMIN)
      nodeAuthorities.forEach((a) => {
        if (a.roleName) map.set(a.roleName, a.authority)
      })
    }

    return map
  }, [authorities, rootNode])

  // 역할 우선순위 점수 계산 함수 (서열 기반)
  const getRolePriority = useMemo(() => {
    return (role: string): number => {
      if (role === 'ADMIN') return 999999
      const mask = roleBitmaskMap.get(role) || (role in DEFAULT_ROLE_AUTHORITIES ? DEFAULT_ROLE_AUTHORITIES[role as keyof typeof DEFAULT_ROLE_AUTHORITIES] : '000100110000001101010111')
      const bitSet = parseAuthorityBitSet(mask)

      let score = 0
      if (bitSet.has(15)) score += 10000 // ROLE_CHANGE
      if (bitSet.has(14)) score += 5000  // ROLE_ASSIGN
      if (bitSet.has(13)) score += 3000  // NODE_DELETE
      if (bitSet.has(12)) score += 2000  // NODE_UPDATE
      if (bitSet.has(11)) score += 1000  // NODE_CREATE
      if (bitSet.has(21)) score += 800   // HISTORY_ALL_VIEW
      if (bitSet.has(9))  score += 500   // WI_OTHERS_CHANGE
      if (bitSet.has(10)) score += 300   // WI_ASSIGN
      if (bitSet.has(17)) score += 200   // FILE_CHANGE
      if (bitSet.has(6))  score += 150   // WI_HIDDEN_VIEW

      const activeCount = AUTHORITY_BITS.filter((b) => b.bit !== 23 && bitSet.has(b.bit)).length
      score += activeCount * 10
      return score
    }
  }, [roleBitmaskMap])

  // 필터 드롭다운에 표시할 모든 고유 역할 목록 (서열 순 정렬)
  const availableRoles = useMemo(() => {
    const nodeAuthorities = authorities.filter((a) => !rootNode || a.nodeId === rootNode.id)
    const roleSet = new Set<string>()

    if (nodeAuthorities.length === 0) {
      PRESET_ROLES.forEach((r) => roleSet.add(r))
    } else {
      roleSet.add('ADMIN')
      nodeAuthorities.forEach((a) => {
        if (a.roleName) roleSet.add(a.roleName)
      })
    }

    // 소속 멤버들에게 부여된 역할도 포함
    roles
      .filter((r) => !r.isDeleted && (!rootNode || r.nodeId === rootNode.id))
      .forEach((r) => {
        if (r.roleName) roleSet.add(r.roleName)
      })

    return (Array.from(roleSet) as RoleName[]).sort((a, b) => {
      const scoreA = getRolePriority(a)
      const scoreB = getRolePriority(b)
      if (scoreA !== scoreB) return scoreB - scoreA
      return a.localeCompare(b)
    })
  }, [authorities, getRolePriority, roles, rootNode])

  // 전체 멤버들의 상속 및 오버라이드 상태 분석
  const memberDetails = useMemo(() => {
    if (!rootNode) return []

    // 1. 현재 노드에 직접 할당된 역할들
    const directRoleMap = new Map<string, RoleName>()
    roles
      .filter((r) => r.nodeId === rootNode.id && !r.isDeleted)
      .forEach((r) => directRoleMap.set(r.userId, r.roleName))

    // 2. 상위 조상 노드 ID 집합 식별 (path 컬럼 활용)
    const ancestorNodeIdSet = new Set<number>()
    if (rootNode.path && Array.isArray(rootNode.path)) {
      rootNode.path.forEach((id) => {
        if (id !== rootNode.id) ancestorNodeIdSet.add(id)
      })
    }

    // 3. 고유 사용자별 최종 상태 계산
    const result: WorkspaceMemberDetail[] = []
    const allUserIds = new Set<string>()

    allRoleMembers.forEach((m) => allUserIds.add(m.userId))
    roles.forEach((r) => {
      if (!r.isDeleted) allUserIds.add(r.userId)
    })

    allUserIds.forEach((userId) => {
      const user = usersById.get(userId)
      const directRole = directRoleMap.get(userId)
      const isDirect = Boolean(directRole)

      // 상위 조상 노드들에 부여된 이 사용자의 역할 조회
      const ancestorRoles = roles.filter(
        (r) => !r.isDeleted && r.userId === userId && ancestorNodeIdSet.has(r.nodeId),
      )

      let isOverridden = false
      let overrideReason = ''
      let effectiveRole: RoleName = directRole ?? 'MEMBER'
      let sourceNodeName = rootNode.name

      // 상위 조상 노드로부터 물려받은 최고 역할 계산
      const inheritedRole =
        ancestorRoles.length > 0
          ? ancestorRoles.reduce((prev, curr) =>
              getRolePriority(curr.roleName) > getRolePriority(prev.roleName) ? curr : prev,
            )
          : null

      if (inheritedRole) {
        const ancestorNode = nodesById.get(inheritedRole.nodeId)
        const ancestorNodeName = ancestorNode?.name || '상위 노드'

        if (directRole && directRole !== inheritedRole.roleName) {
          // 상위 역할이 있는데 현재 노드에서 다르게 직접 재정의된 경우 => 진짜 오버라이드!
          isOverridden = true
          overrideReason = `${ancestorNodeName} (${inheritedRole.roleName}) ➔ ${rootNode.name} 직속 재정의 (${directRole})`
          effectiveRole = directRole
          sourceNodeName = rootNode.name
        } else if (!directRole) {
          // 직속 할당 없이 상위에서 상속받은 경우
          effectiveRole = inheritedRole.roleName
          sourceNodeName = ancestorNodeName
        }
      }

      const name = user?.name || allRoleMembers.find((m) => m.userId === userId)?.name || userId
      const email = user?.email || allRoleMembers.find((m) => m.userId === userId)?.email || ''

      result.push({
        userId,
        name,
        email,
        effectiveRoleName: effectiveRole,
        directRoleName: directRole,
        inheritedRoleName: inheritedRole?.roleName,
        isDirect,
        isOverridden,
        sourceNodeName,
        overrideReason,
        assignedNodeId: rootNode.id,
      })
    })

    // 기본 정렬: 역할 우선순위 -> 이름순
    return result.sort((a, b) => {
      const priorityDiff = getRolePriority(b.effectiveRoleName) - getRolePriority(a.effectiveRoleName)
      if (priorityDiff !== 0) return priorityDiff
      return a.name.localeCompare(b.name, 'ko')
    })
  }, [allRoleMembers, getRolePriority, nodesById, roles, rootNode, usersById])

  // 세그먼트별 집계
  const directMembers = useMemo(() => memberDetails.filter((m) => m.isDirect), [memberDetails])
  const overriddenMembers = useMemo(() => memberDetails.filter((m) => m.isOverridden), [memberDetails])

  // 현재 활성 세그먼트 데이터
  const segmentItems = useMemo(() => {
    if (activeSegment === 'direct') return directMembers
    if (activeSegment === 'overridden') return overriddenMembers
    return memberDetails
  }, [activeSegment, directMembers, memberDetails, overriddenMembers])

  // 검색 및 역할 필터링
  const filteredItems = useMemo(() => {
    let list = segmentItems

    if (roleFilter !== 'all') {
      list = list.filter((m) => m.effectiveRoleName === roleFilter)
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
                {roleFilter === 'all' ? '모든 역할' : roleFilter}
              </span>
              <span className={styles.roleTriggerCount}>
                {roleFilter === 'all'
                  ? memberDetails.length
                  : memberDetails.filter((m) => m.effectiveRoleName === roleFilter).length}
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

                {availableRoles.map((role) => {
                  const count = memberDetails.filter((m) => m.effectiveRoleName === role).length
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
                        style={getRoleBadgeStyle(role)}
                      >
                        {role}
                      </span>
                      <span className={styles.roleItemCount}>{count}명</span>
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          {/* 사용자 추가 버튼 */}
          <button
            type="button"
            className={styles.addMemberBtn}
            onClick={() => setIsAddModalOpen(true)}
          >
            <Icon name="plus" size={14} />
            <span>사용자 추가</span>
          </button>
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
                        style={getRoleBadgeStyle(member.effectiveRoleName)}
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
                      <Button variant="secondary" className={styles.actionBtn}>
                        권한 확인
                      </Button>
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
        availableRoles={availableRoles}
        isSubmitting={isAddingMember}
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
