import { useMemo, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleMember,
  RoleName,
  UserRecord,
} from '../model/types'
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

const ROLE_PRIORITY: Record<RoleName, number> = {
  ADMIN: 4,
  MANAGER: 3,
  MEMBER: 2,
  VIEWER: 1,
}

export function WorkspaceMembersTab({
  rootNode,
  nodes = [],
  roles = [],
  users = [],
  allRoleMembers = [],
}: WorkspaceMembersTabProps) {
  const [activeSegment, setActiveSegment] = useState<MemberSegmentType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | RoleName>('all')

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const usersById = useMemo(() => new Map(users.map((u) => [u.userId, u])), [users])

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
              ROLE_PRIORITY[curr.roleName] > ROLE_PRIORITY[prev.roleName] ? curr : prev,
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
      const priorityDiff = ROLE_PRIORITY[b.effectiveRoleName] - ROLE_PRIORITY[a.effectiveRoleName]
      if (priorityDiff !== 0) return priorityDiff
      return a.name.localeCompare(b.name, 'ko')
    })
  }, [allRoleMembers, nodesById, roles, rootNode, usersById])

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

          <select
            className={styles.roleSelect}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | RoleName)}
            aria-label="역할 필터"
          >
            <option value="all">모든 역할</option>
            <option value="ADMIN">ADMIN (관리자)</option>
            <option value="MANAGER">MANAGER (매니저)</option>
            <option value="MEMBER">MEMBER (멤버)</option>
            <option value="VIEWER">VIEWER (조회자)</option>
          </select>
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
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyCell}>
                    <Icon name="users" size={28} />
                    <p>해당 조건에 일치하는 사용자가 없습니다.</p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((member) => (
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
                      <span className={styles.roleBadge} data-role={member.effectiveRoleName}>
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
      </div>
    </div>
  )
}
