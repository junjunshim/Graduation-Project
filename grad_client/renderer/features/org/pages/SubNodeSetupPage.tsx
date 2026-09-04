import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { createSubNode, fetchNodeDetail, getNodePathLabel, getOrgSnapshot } from '../../workspace/data/orgService'
import { ORG_NODE_TYPE_OPTIONS } from '../../workspace/model/options'
import { getNodeTypeLabel } from '../../workspace/model/labels'
import { analyzeWorkspaceMembers } from '../../workspace/model/memberInheritance'
import { canCreateSubNode, isEligibleAsSubNodeOwner } from '../../workspace/model/effectiveAuthority'
import type { StandardNodeType, WorkspaceSnapshot } from '../../workspace/model/types'
import styles from './SubNodeSetupPage.module.css'

type NodeTypeOption = Exclude<StandardNodeType, 'USER'>

const NODE_TYPE_DETAILS: Record<
  NodeTypeOption,
  { label: string; description: string; icon: IconName; tone: string }
> = {
  COMPANY: {
    label: '회사 (Company)',
    description: '법인 및 자회사 단위의 하위 워크스페이스입니다.',
    icon: 'building',
    tone: styles.typeCompany,
  },
  DIVISION: {
    label: '본부 (Division)',
    description: '사업 부문이나 대규모 본부 단위 워크스페이스입니다.',
    icon: 'orgChart',
    tone: styles.typeDivision,
  },
  DEPARTMENT: {
    label: '부서 (Department)',
    description: '특정 기능 및 팀들이 모인 부서 단위 워크스페이스입니다.',
    icon: 'folder',
    tone: styles.typeDepartment,
  },
  TEAM: {
    label: '팀 (Team)',
    description: '실무를 수행하는 소규모 스쿼드 및 팀 단위 워크스페이스입니다.',
    icon: 'users',
    tone: styles.typeTeam,
  },
  PROJECT: {
    label: '프로젝트 (Project)',
    description: '목표 지향형 TFT나 특정 프로젝트를 위한 워크스페이스입니다.',
    icon: 'cube',
    tone: styles.typeProject,
  },
}

const CUSTOM_ICON_OPTIONS: { icon: IconName; label: string }[] = [
  { icon: 'sparkles', label: '기본(반짝임)' },
  { icon: 'building', label: '빌딩' },
  { icon: 'flask', label: '연구/실험' },
  { icon: 'cube', label: '스튜디오/큐브' },
  { icon: 'globe', label: '글로벌/지사' },
  { icon: 'database', label: '데이터/인프라' },
  { icon: 'users', label: '모임/동아리' },
  { icon: 'star', label: '스페셜' },
  { icon: 'pencil', label: '디자인/창작' },
  { icon: 'folder', label: '자료/그룹' },
]

export function SubNodeSetupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const parentNodeIdParam = searchParams.get('parentNodeId')
  const parentNodeId = parentNodeIdParam ? parseInt(parentNodeIdParam, 10) : null

  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(() => getOrgSnapshot())
  const currentUser = getCurrentUser(snapshot)

  const [nodeType, setNodeType] = useState<StandardNodeType | 'CUSTOM'>('TEAM')
  const [customTypeName, setCustomTypeName] = useState('')
  const [customIcon, setCustomIcon] = useState<IconName>('sparkles')
  const [name, setName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState(currentUser?.email || '')
  const [isOwnerDropdownOpen, setIsOwnerDropdownOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  const ownerPickerRef = useRef<HTMLDivElement>(null)

  // 드롭다운 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ownerPickerRef.current && !ownerPickerRef.current.contains(event.target as Node)) {
        setIsOwnerDropdownOpen(false)
      }
    }
    if (isOwnerDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOwnerDropdownOpen])

  // 부모 노드 최신 정보 로드
  useEffect(() => {
    if (parentNodeId && Number.isFinite(parentNodeId)) {
      fetchNodeDetail(parentNodeId)
        .then((latestSnapshot) => setSnapshot(latestSnapshot))
        .catch(() => setSnapshot(getOrgSnapshot()))
    }
  }, [parentNodeId])

  const parentNode = useMemo(() => {
    if (!parentNodeId) return null
    return snapshot.nodes.find((n) => n.id === parentNodeId) ?? null
  }, [snapshot.nodes, parentNodeId])

  // 형제(기존 하위) 워크스페이스 목록: 부모 노드를 parentNodeId로 두고 있는 기존 자식 노드들
  const siblingNodes = useMemo(() => {
    if (!parentNodeId) return []
    return snapshot.nodes.filter((n) => n.parentNodeId === parentNodeId && n.nodeType !== 'USER')
  }, [snapshot.nodes, parentNodeId])

  // 권한 체크: 현재 로그인 유저가 부모 노드에 대해 NODE_SUB_CREATE(Bit 13) 권한이 있는지 검사
  const hasSubCreatePermission = useMemo(() => {
    if (!currentUser || !parentNodeId) return false
    return canCreateSubNode(currentUser.userId, parentNodeId, snapshot)
  }, [currentUser, parentNodeId, snapshot])

  // 소유자 후보 목록: 부모 노드의 구성원 중 WI_PERSONAL_CHANGE(Bit 8) 권한을 보유한 멤버들만 필터링
  const eligibleOwners = useMemo(() => {
    if (!parentNode) return []

    const memberAnalysis = analyzeWorkspaceMembers({
      rootNode: parentNode,
      nodes: snapshot.nodes,
      roles: snapshot.roles,
      users: snapshot.users,
      authorities: snapshot.authorities,
    })

    return memberAnalysis.all.filter((m) => {
      if (!m.email && !m.userId) return false
      return isEligibleAsSubNodeOwner(m.userId, parentNode.id, snapshot)
    })
  }, [parentNode, snapshot])

  // 기본 ownerEmail 동기화
  useEffect(() => {
    if (eligibleOwners.length > 0) {
      const currentEmail = currentUser?.email || ''
      const hasCurrent = eligibleOwners.some((o) => o.email === currentEmail || o.userId === currentUser?.userId)
      if (!hasCurrent) {
        setOwnerEmail(eligibleOwners[0].email || eligibleOwners[0].userId)
      } else if (!ownerEmail) {
        setOwnerEmail(currentEmail)
      }
    }
  }, [eligibleOwners, currentUser, ownerEmail])

  if (!currentUser) {
    return null
  }

  if (!parentNode) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyCard}>
          <Icon name="alertTriangle" size={32} className={styles.emptyIcon} />
          <h2>부모 워크스페이스를 찾을 수 없습니다.</h2>
          <p>하위 워크스페이스를 생성할 상위 워크스페이스를 먼저 지정해 주세요.</p>
          <Button variant="primary" onClick={() => navigate('/workspace/select')}>
            워크스페이스 계층도로 이동
          </Button>
        </div>
      </div>
    )
  }

  if (!hasSubCreatePermission) {
    return (
      <div className={styles.page}>
        <div className={styles.emptyCard}>
          <Icon name="alertTriangle" size={32} className={styles.emptyIcon} />
          <h2>하위 워크스페이스 생성 권한이 없습니다.</h2>
          <p>
            <strong>{parentNode.name}</strong> 워크스페이스에 대한 하위 노드 생성(NODE_SUB_CREATE) 권한이 부족합니다.
          </p>
          <Button variant="secondary" onClick={() => navigate(`/workspace?nodeId=${parentNode.id}`)}>
            {parentNode.name} 상세페이지로 돌아가기
          </Button>
        </div>
      </div>
    )
  }

  const selectedOwner = eligibleOwners.find((o) => o.email === ownerEmail || o.userId === ownerEmail) ?? {
    name: currentUser.name,
    email: ownerEmail || currentUser.email || currentUser.userId,
    userId: currentUser.userId,
    effectiveRoleName: 'MEMBER' as const,
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting || !parentNode) {
      return
    }

    setSubmitting(true)
    setFeedback(null)

    if (nodeType === 'CUSTOM' && !customTypeName.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '사용자 지정 워크스페이스 유형을 입력해 주세요.' })
      return
    }

    if (!name.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '하위 워크스페이스 이름을 입력해 주세요.' })
      return
    }

    if (!ownerEmail.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '하위 워크스페이스를 관리할 담당자를 선택해 주세요.' })
      return
    }

    const finalNodeType =
      nodeType === 'CUSTOM'
        ? `CUSTOM:${customTypeName.trim().toUpperCase()}:${customIcon}`
        : nodeType

    try {
      const response = await createSubNode({
        parentNodeId: parentNode.id,
        nodeType: finalNodeType,
        name: name.trim(),
        email: ownerEmail.trim(),
        roleName: 'ADMIN',
      })

      if (response.status === 'error') {
        setFeedback({ tone: 'error', message: response.message || '하위 워크스페이스를 만들지 못했습니다.' })
        return
      }

      if (response.newNodeId) {
        const newNodeIdStr = String(response.newNodeId)
        navigate(`/workspace?nodeId=${encodeURIComponent(newNodeIdStr)}`)
      } else {
        navigate(`/workspace?nodeId=${parentNode.id}`)
      }
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '하위 워크스페이스를 만들지 못했습니다.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const currentTypeInfo =
    nodeType === 'CUSTOM'
      ? {
          label: customTypeName.trim() ? `${customTypeName.trim()} (사용자 지정)` : '사용자 지정 유형',
          description: '자유롭게 정의한 커스텀 워크스페이스 공간입니다.',
          icon: customIcon,
          tone: styles.typeCustom,
        }
      : NODE_TYPE_DETAILS[nodeType as NodeTypeOption]

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <main className={styles.mainPanel}>
          <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
            {/* 1. 공간 유형 선택 */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.stepBadge}>01</span>
                <div>
                  <h2 className={styles.sectionTitle}>하위 워크스페이스 유형 선택</h2>
                  <p className={styles.sectionSubtitle}>상위 조직의 구조에 부합하는 적절한 하위 유형을 선택하세요.</p>
                </div>
              </div>

              <div className={styles.typeGrid} role="radiogroup" aria-label="워크스페이스 유형 선택">
                {ORG_NODE_TYPE_OPTIONS.map((type) => {
                  const info = NODE_TYPE_DETAILS[type]
                  const isSelected = nodeType === type

                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={[styles.typeCard, isSelected ? styles.typeCardSelected : ''].filter(Boolean).join(' ')}
                      onClick={() => setNodeType(type)}
                      disabled={submitting}
                    >
                      <span className={[styles.typeIcon, info.tone].join(' ')}>
                        <Icon name={info.icon} size={22} />
                      </span>
                      <span className={styles.typeCopy}>
                        <strong>{info.label}</strong>
                        <small>{info.description}</small>
                      </span>
                      <span className={styles.typeRadioMark}>
                        <i />
                      </span>
                    </button>
                  )
                })}

                {/* 사용자 지정 (커스텀) 유형 선택 */}
                <button
                  type="button"
                  role="radio"
                  aria-checked={nodeType === 'CUSTOM'}
                  className={[styles.typeCard, nodeType === 'CUSTOM' ? styles.typeCardSelected : ''].filter(Boolean).join(' ')}
                  onClick={() => setNodeType('CUSTOM')}
                  disabled={submitting}
                >
                  <span className={[styles.typeIcon, styles.typeCustom].join(' ')}>
                    <Icon name="sparkles" size={22} />
                  </span>
                  <span className={styles.typeCopy}>
                    <strong>직접 입력 (사용자 지정 유형)</strong>
                    <small>스쿼드, 챕터, 태스크포스(TFT), 연구 파트 등 원하는 조직 단위를 직접 정의합니다.</small>
                  </span>
                  <span className={styles.typeRadioMark}>
                    <i />
                  </span>
                </button>
              </div>

              {/* 사용자 지정 유형 선택 시 자연스럽게 펼쳐지고 접히는 입력 필드 */}
              <div
                className={[
                  styles.customTypeCollapse,
                  nodeType === 'CUSTOM' ? styles.customTypeExpanded : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden={nodeType !== 'CUSTOM'}
              >
                <div className={styles.customTypeCollapseInner}>
                  <div className={styles.customTypeField}>
                    <label className={styles.customTypeLabel} htmlFor="custom-type-input">
                      <Icon name="sparkles" size={15} />
                      사용자 지정 유형명 입력
                    </label>
                    <input
                      id="custom-type-input"
                      type="text"
                      className={styles.customTypeInput}
                      disabled={submitting || nodeType !== 'CUSTOM'}
                      tabIndex={nodeType === 'CUSTOM' ? 0 : -1}
                      value={customTypeName}
                      onChange={(event) => setCustomTypeName(event.target.value)}
                      placeholder="예: 프론트엔드 챕터, 코어엔진 파트, TFT 2기"
                      autoFocus={nodeType === 'CUSTOM'}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. 워크스페이스 명칭 입력 */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.stepBadge}>02</span>
                <div>
                  <h2 className={styles.sectionTitle}>하위 워크스페이스 이름</h2>
                  <p className={styles.sectionSubtitle}>상위 조직 아래에서 명확히 구분되는 이름을 지정하세요.</p>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <input
                  type="text"
                  className={styles.nameInput}
                  disabled={submitting}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="예: 플랫폼개발팀, UI/UX 디자인 파트, 고객경험 혁신 TFT"
                  autoFocus
                />
              </div>
            </div>

            {/* 3. 하위 워크스페이스 담당 관리자 지정 */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.stepBadge}>03</span>
                <div>
                  <h2 className={styles.sectionTitle}>초기 관리자 (소유자) 지정</h2>
                  <p className={styles.sectionSubtitle}>
                    부모 워크스페이스의 권한을 보유한 구성원 중 하위 공간을 이끌 관리자를 선택합니다.
                  </p>
                </div>
              </div>

              <div className={styles.inputGroup}>
                {eligibleOwners.length > 0 ? (
                  <div className={styles.customOwnerPicker} ref={ownerPickerRef}>
                    {/* 선택된 담당자 트리거 버튼 */}
                    <button
                      type="button"
                      className={[
                        styles.ownerTrigger,
                        isOwnerDropdownOpen ? styles.ownerTriggerOpen : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setIsOwnerDropdownOpen((prev) => !prev)}
                      disabled={submitting}
                      aria-haspopup="listbox"
                      aria-expanded={isOwnerDropdownOpen}
                    >
                      <UserAvatar
                        name={selectedOwner.name}
                        userId={selectedOwner.userId}
                        size="small"
                      />
                      <div className={styles.ownerTriggerMeta}>
                        <span className={styles.ownerTriggerName}>{selectedOwner.name}</span>
                        <span className={styles.ownerTriggerEmail}>
                          {selectedOwner.email || selectedOwner.userId}
                        </span>
                      </div>

                      <div className={styles.ownerTriggerBadges}>
                        <span className={styles.ownerRoleBadge}>{selectedOwner.effectiveRoleName}</span>
                        <span className={styles.ownerSourceBadge}>
                          {'isDirect' in selectedOwner && selectedOwner.isDirect
                            ? '직속'
                            : 'isOverridden' in selectedOwner && selectedOwner.isOverridden
                            ? `오버라이드 (${selectedOwner.sourceNodeName})`
                            : `${('sourceNodeName' in selectedOwner && selectedOwner.sourceNodeName) || '상위'} 상속`}
                        </span>
                        {selectedOwner.userId === currentUser.userId && (
                          <span className={styles.ownerMeBadge}>나</span>
                        )}
                      </div>

                      <Icon
                        name={isOwnerDropdownOpen ? 'chevronUp' : 'chevronDown'}
                        size={16}
                        className={styles.ownerTriggerChevron}
                      />
                    </button>

                    {/* 드롭다운 메뉴 리스트 */}
                    {isOwnerDropdownOpen && (
                      <div className={styles.ownerDropdownMenu} role="listbox">
                        {eligibleOwners.map((owner) => {
                          const isSelected =
                            owner.email === ownerEmail || owner.userId === ownerEmail
                          const isMe =
                            owner.userId === currentUser.userId ||
                            owner.email === currentUser.email
                          const sourceLabel = owner.isOverridden
                            ? `오버라이드 (${owner.sourceNodeName})`
                            : owner.isDirect
                            ? '직속'
                            : `${owner.sourceNodeName || '상위'} 상속`

                          return (
                            <button
                              key={owner.userId}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              className={[
                                styles.ownerOptionItem,
                                isSelected ? styles.ownerOptionItemSelected : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                setOwnerEmail(owner.email || owner.userId)
                                setIsOwnerDropdownOpen(false)
                              }}
                            >
                              <UserAvatar
                                name={owner.name}
                                userId={owner.userId}
                                size="small"
                              />
                              <div className={styles.ownerOptionMeta}>
                                <div className={styles.ownerOptionTitleRow}>
                                  <strong className={styles.ownerOptionName}>
                                    {owner.name}
                                  </strong>
                                  {isMe && <span className={styles.ownerMeBadge}>나</span>}
                                </div>
                                <span className={styles.ownerOptionEmail}>
                                  {owner.email || owner.userId}
                                </span>
                              </div>

                              <div className={styles.ownerOptionBadges}>
                                <span className={styles.ownerRoleBadge}>
                                  {owner.effectiveRoleName}
                                </span>
                                <span
                                  className={[
                                    styles.ownerSourceBadge,
                                    owner.isDirect ? styles.ownerSourceDirect : styles.ownerSourceInherited,
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {sourceLabel}
                                </span>
                              </div>

                              {isSelected && (
                                <Icon
                                  name="checkCircle"
                                  size={16}
                                  className={styles.ownerSelectedCheck}
                                />
                              )}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <input
                    type="email"
                    className={styles.nameInput}
                    disabled={submitting}
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    placeholder="담당자 이메일 입력"
                  />
                )}
                <small className={styles.ownerHint}>
                  <Icon name="checkCircle" size={13} />
                  선택된 담당자는 새로 생성되는 하위 워크스페이스의 최고 관리자(ADMIN)로 자동 등록됩니다.
                </small>
              </div>
            </div>

            {/* 피드백 메시지 */}
            {feedback ? (
              <div
                className={[
                  styles.feedback,
                  feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
                ].join(' ')}
                role={feedback.tone === 'error' ? 'alert' : 'status'}
              >
                <Icon name={feedback.tone === 'error' ? 'alertTriangle' : 'checkCircle'} size={18} />
                <span>{feedback.message}</span>
              </div>
            ) : null}

            {/* 하단 액션 버튼 */}
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                className={styles.cancelButton}
                onClick={() => navigate(parentNode ? `/workspace?nodeId=${parentNode.id}` : '/workspace/select')}
                disabled={submitting}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="primary"
                className={styles.submitButton}
                disabled={submitting || !name.trim() || !ownerEmail.trim()}
              >
                <Icon name="plus" size={17} />
                {submitting ? '하위 워크스페이스 생성 중...' : '하위 워크스페이스 생성'}
              </Button>
            </div>
          </form>
        </main>

        {/* 우측 사이드바: 1. 생성 워크스페이스 현황 (부모 + 형제) -> 2. 미리보기 -> 3. 관리자/안내 */}
        <aside className={styles.sidebar}>
          {/* ✨ 1. 생성 워크스페이스 현황 패널 (부모 및 형제 워크스페이스) */}
          <section className={[styles.sideCard, styles.parentCard].join(' ')}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>생성 워크스페이스 현황</h3>
              <span className={styles.parentBadge}>소속 현황</span>
            </div>
            
            <div className={styles.statusSection}>
              <span className={styles.statusSectionLabel}>
                <Icon name="building" size={13} />
                상위 부모 워크스페이스
              </span>
              <div className={styles.parentBox}>
                <div className={styles.parentHeader}>
                  <span className={styles.parentIcon}>
                    <Icon name="folder" size={18} />
                  </span>
                  <strong className={styles.parentName}>{parentNode.name}</strong>
                  <span className={styles.parentTypeBadge}>{getNodeTypeLabel(parentNode.nodeType)}</span>
                </div>
                <p className={styles.parentPath}>
                  <Icon name="orgChart" size={13} />
                  <span>{getNodePathLabel(parentNode.id, snapshot.nodes)}</span>
                </p>
              </div>
            </div>

            <div className={styles.statusSection}>
              <div className={styles.siblingHeader}>
                <span className={styles.statusSectionLabel}>
                  <Icon name="users" size={13} />
                  동일 부모 하위 공간 (형제 워크스페이스)
                </span>
                <span className={styles.siblingCount}>{siblingNodes.length}개</span>
              </div>
              
              {siblingNodes.length > 0 ? (
                <div className={styles.siblingList}>
                  {siblingNodes.map((sibling) => (
                    <div key={sibling.id} className={styles.siblingItem}>
                      <span className={styles.siblingIcon}>
                        <Icon name="folder" size={14} />
                      </span>
                      <span className={styles.siblingName} title={sibling.name}>
                        {sibling.name}
                      </span>
                      <span className={styles.siblingTypeBadge}>
                        {getNodeTypeLabel(sibling.nodeType)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptySibling}>
                  <small>현재 등록된 하위 워크스페이스가 없습니다.</small>
                </div>
              )}
            </div>
          </section>

          {/* 2. 생성될 하위 워크스페이스 실시간 미리보기 카드 */}
          <section className={styles.sideCard}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>미리보기</h3>
              <span className={styles.subPill}>하위 공간</span>
            </div>
            <div className={styles.previewBox}>
              <span className={[styles.previewGlyph, currentTypeInfo.tone].join(' ')}>
                <Icon name={currentTypeInfo.icon} size={26} />
              </span>
              <div className={styles.previewInfo}>
                <strong className={styles.previewName}>{name.trim() || '하위 워크스페이스 이름'}</strong>
                <span className={styles.previewType}>{currentTypeInfo.label}</span>
                <span className={styles.previewMembers}>
                  <Icon name="users" size={14} />
                  관리자: {selectedOwner.name}
                </span>
              </div>
            </div>

            {/* 직접 입력 시 자연스럽게 펼쳐지고 접히는 전용 아이콘 선택 팔레트 */}
            <div
              className={[
                styles.previewIconPickerCollapse,
                nodeType === 'CUSTOM' ? styles.previewIconPickerExpanded : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden={nodeType !== 'CUSTOM'}
            >
              <div className={styles.previewIconPickerCollapseInner}>
                <div className={styles.previewIconPickerSection}>
                  <div className={styles.previewIconPickerHeader}>
                    <span className={styles.previewIconPickerLabel}>
                      <Icon name="star" size={13} />
                      전용 아이콘 선택
                    </span>
                    <small className={styles.previewIconPickerSub}>원하는 아이콘을 클릭하세요</small>
                  </div>
                  <div className={styles.customIconGrid} role="radiogroup" aria-label="커스텀 아이콘 선택">
                    {CUSTOM_ICON_OPTIONS.map(({ icon, label }) => {
                      const isIconSelected = customIcon === icon
                      return (
                        <button
                          key={icon}
                          type="button"
                          role="radio"
                          aria-checked={isIconSelected}
                          title={label}
                          className={[
                            styles.customIconButton,
                            isIconSelected ? styles.customIconButtonActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setCustomIcon(icon)}
                          disabled={submitting || nodeType !== 'CUSTOM'}
                          tabIndex={nodeType === 'CUSTOM' ? 0 : -1}
                        >
                          <Icon name={icon} size={17} />
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* 3. 소유자 및 권한 카드 */}
          <section className={styles.sideCard}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>지정 관리자 및 역할</h3>
            </div>
            <div className={styles.creatorProfile}>
              <UserAvatar name={selectedOwner.name} userId={selectedOwner.userId} size="medium" />
              <div className={styles.creatorMeta}>
                <strong>{selectedOwner.name}</strong>
                <small>{selectedOwner.email || selectedOwner.userId}</small>
                {'isDirect' in selectedOwner ? (
                  <small style={{ color: 'var(--axis-brand-primary, #625cf2)', fontWeight: 650 }}>
                    {selectedOwner.isOverridden
                      ? `오버라이드 (${selectedOwner.sourceNodeName})`
                      : selectedOwner.isDirect
                      ? '부모 직속'
                      : `${selectedOwner.sourceNodeName || '상위'} 상속`}
                  </small>
                ) : null}
              </div>
              <span className={styles.adminBadge}>ADMIN</span>
            </div>
            <p className={styles.creatorNotice}>
              지정된 관리자는 하위 공간에 대해 독립적인 <strong>ADMIN</strong> 권한을 가지며, 팀원 배정 및 업무를 주도할 수 있습니다.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
