import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { createTopNode } from '../../workspace/data/orgService'
import { selectWorkspaceRoot } from '../../workspace/data/workspaceDirectorySelection'
import { ORG_NODE_TYPE_OPTIONS } from '../../workspace/model/options'
import type { StandardNodeType } from '../../workspace/model/types'
import styles from './TopNodeSetupPage.module.css'

type NodeTypeOption = Exclude<StandardNodeType, 'USER'>

const NODE_TYPE_DETAILS: Record<
  NodeTypeOption,
  { label: string; description: string; icon: IconName; tone: string }
> = {
  COMPANY: {
    label: '회사 (Company)',
    description: '기업 전사 조직의 최상위 루트 워크스페이스입니다.',
    icon: 'building',
    tone: styles.typeCompany,
  },
  DIVISION: {
    label: '본부 (Division)',
    description: '사업 부문이나 대규모 본부 단위의 최상위 워크스페이스입니다.',
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
    description: '소규모 스쿼드 및 팀 단위의 최상위 워크스페이스입니다.',
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

export function TopNodeSetupPage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const [nodeType, setNodeType] = useState<StandardNodeType | 'CUSTOM'>('COMPANY')
  const [customTypeName, setCustomTypeName] = useState('')
  const [customIcon, setCustomIcon] = useState<IconName>('sparkles')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  if (!currentUser) {
    return null
  }

  const user = currentUser

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
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
      setFeedback({ tone: 'error', message: '루트 워크스페이스 이름을 입력해 주세요.' })
      return
    }

    const finalNodeType =
      nodeType === 'CUSTOM'
        ? `CUSTOM:${customTypeName.trim().toUpperCase()}:${customIcon}`
        : nodeType

    try {
      const response = await createTopNode({
        nodeType: finalNodeType,
        name: name.trim(),
        userId: user.userId,
        roleName: 'ADMIN',
      })

      if (response.status === 'error') {
        setFeedback({ tone: 'error', message: response.message || '루트 워크스페이스를 만들지 못했습니다.' })
        return
      }

      if (response.newNodeId) {
        selectWorkspaceRoot(String(response.newNodeId), false, user.userId)
      }

      navigate('/workspace/select')
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '루트 워크스페이스를 만들지 못했습니다.',
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
                  <h2 className={styles.sectionTitle}>워크스페이스 유형 선택</h2>
                  <p className={styles.sectionSubtitle}>루트 워크스페이스의 성격에 맞는 조직 유형을 선택하세요.</p>
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
                    <small>학회, 동아리, 랩실, 스튜디오, 지사 등 원하는 조직 유형을 직접 정의합니다.</small>
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
                      placeholder="예: 랩실, 스튜디오, 학회, 연합동아리, 지사, 센터"
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
                  <h2 className={styles.sectionTitle}>워크스페이스 이름</h2>
                  <p className={styles.sectionSubtitle}>조직 구성원들이 명확히 구분할 수 있는 이름을 지정하세요.</p>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <input
                  type="text"
                  className={styles.nameInput}
                  disabled={submitting}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="예: Acme Corp, 커머스사업본부, 차세대 결제 시스템 TFT"
                  autoFocus
                />
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
                onClick={() => navigate('/workspace/select')}
                disabled={submitting}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="primary"
                className={styles.submitButton}
                disabled={submitting || !name.trim()}
              >
                <Icon name="plus" size={17} />
                {submitting ? '워크스페이스 생성 중...' : '루트 워크스페이스 생성'}
              </Button>
            </div>
          </form>
        </main>

        {/* 우측 사이드바: 미리보기 & 계정/권한 정보 */}
        <aside className={styles.sidebar}>
          {/* 생성될 워크스페이스 실시간 미리보기 카드 */}
          <section className={styles.sideCard}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>미리보기</h3>
              <span className={styles.rootPill}>루트 공간</span>
            </div>
            <div className={styles.previewBox}>
              <span className={[styles.previewGlyph, currentTypeInfo.tone].join(' ')}>
                <Icon name={currentTypeInfo.icon} size={26} />
              </span>
              <div className={styles.previewInfo}>
                <strong className={styles.previewName}>{name.trim() || '워크스페이스 이름'}</strong>
                <span className={styles.previewType}>{currentTypeInfo.label}</span>
                <span className={styles.previewMembers}>
                  <Icon name="users" size={14} />
                  생성자 1명 (초기 관리자)
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

          {/* 소유자 및 권한 카드 */}
          <section className={styles.sideCard}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>생성자 및 기본 권한</h3>
            </div>
            <div className={styles.creatorProfile}>
              <UserAvatar name={user.name} userId={user.userId} size="medium" />
              <div className={styles.creatorMeta}>
                <strong>{user.name}</strong>
                <small>{user.email || user.userId}</small>
              </div>
              <span className={styles.adminBadge}>ADMIN</span>
            </div>
            <p className={styles.creatorNotice}>
              루트 워크스페이스를 생성한 계정은 자동으로 <strong>ADMIN(총괄 관리자)</strong> 역할을 부여받으며, 하위 조직과 팀원을 관리할 수 있습니다.
            </p>
          </section>

          {/* 안내 가이드 카드 */}
          <section className={styles.sideCard}>
            <div className={styles.sideCardHeader}>
              <h3 className={styles.sideCardTitle}>생성 후 진행 가이드</h3>
            </div>
            <ol className={styles.guideStepList}>
              <li>
                <strong>하위 조직 트리 구성</strong>
                <p>생성된 루트 아래에 본부, 팀, 프로젝트 등 하위 노드를 자유롭게 확장합니다.</p>
              </li>
              <li>
                <strong>멤버 초대 및 역할 배정</strong>
                <p>각 조직 노드별로 팀원을 초대하고 적절한 권한(Manager, Member 등)을 부여합니다.</p>
              </li>
              <li>
                <strong>업무 및 파일 공유</strong>
                <p>조직에 소속된 업무를 생성하고 타임라인과 문서를 함께 관리합니다.</p>
              </li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

