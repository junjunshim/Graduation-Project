import { Link } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { getNodeTypeLabel, getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import type { WorkspaceNodeView, WorkItemRecord } from '../../workspace/model/types'
import styles from './DashboardPage.module.css'

function NodeTree({ node }: { node: WorkspaceNodeView }) {
  return (
    <li className={styles.treeItem}>
      <div className={styles.treeRow}>
        <div className={styles.nodeTitleBlock}>
          <strong className={styles.nodeTitle}>{node.title}</strong>
          <p className={styles.nodePath}>{node.path}</p>
        </div>
        <div className={styles.nodeMetaBlock}>
          <span className={styles.nodeBadge}>{getNodeTypeLabel(node.nodeType)}</span>
          <span className={styles.nodeMeta}>직속 업무 {node.workItems.length}개</span>
        </div>
      </div>

      {node.children.length > 0 ? (
        <ul className={styles.treeChildren}>
          {node.children.map((child) => (
            <NodeTree key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function WorkItemRow({ item }: { item: WorkItemRecord }) {
  const tone = getWorkItemStatusTone(item.status)

  return (
    <Link to={`/work-items/${item.workItemId}`} className={[styles.workItemRow, styles.workItemLink].join(' ')}>
      <div className={styles.workItemCopy}>
        <strong className={styles.workItemTitle}>{item.title}</strong>
        <p className={styles.workItemMeta}>
          {item.workItemId} · 담당자 {item.ownerUserId} · 진행률 {item.progress}% · 우선순위 {item.priority} · 마감{' '}
          {formatWorkspaceDate(item.dueDate)}
        </p>
      </div>

      <span
        className={[
          styles.statusBadge,
          tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
        ].join(' ')}
      >
        {getWorkItemStatusLabel(item.status)}
      </span>
    </Link>
  )
}

export function DashboardPage() {
  const currentUser = getCurrentUser()

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId)
  const workspaceName = overview.rootNode?.name ?? '워크스페이스'
  const summaryCards = [
    { label: '공유 조직', value: overview.summary.orgNodeCount, description: '운영 중인 조직 수' },
    { label: '전체 업무', value: overview.summary.workItemCount, description: '현재 조회 가능한 업무' },
    { label: '평균 진행률', value: `${overview.summary.averageProgress}%`, description: '전체 업무 기준 평균' },
    { label: '루트 업무', value: overview.summary.rootWorkItemCount, description: '상위 업무 기준 집계' },
  ]

  if (overview.summary.orgNodeCount === 0) {
    return (
      <section className={styles.page}>
        <header className={styles.pageIntro}>
          <p className={styles.eyebrow}>Onboarding</p>
          <h2 className={styles.title}>공유 공간을 만들고 운영을 시작하세요.</h2>
          <p className={styles.description}>
            개인 공간은 준비되었습니다. 이제 팀이 함께 사용할 공간을 만들고 담당자와 업무를 연결해 보세요.
          </p>
        </header>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Checklist</p>
              <h3 className={styles.sectionTitle}>시작 순서</h3>
            </div>
          </div>

          <div className={styles.onboardingList}>
            {overview.onboardingSteps.map((step, index) => (
              <article key={step.id} className={styles.onboardingItem}>
                <div className={styles.onboardingMeta}>
                  <span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <strong className={styles.onboardingTitle}>{step.title}</strong>
                    <p className={styles.onboardingDescription}>{step.description}</p>
                  </div>
                </div>

                <div className={styles.onboardingActions}>
                  <span
                    className={[
                      styles.statusBadge,
                      step.status === 'complete'
                        ? styles.statusDone
                        : step.status === 'current'
                          ? styles.statusInProgress
                          : styles.statusTodo,
                    ].join(' ')}
                  >
                    {step.status === 'complete' ? '완료' : step.status === 'current' ? '진행 중' : '예정'}
                  </span>
                  <Link to={step.href} className={styles.inlineLink}>
                    이동
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.pageIntro}>
        <p className={styles.eyebrow}>Workspace Overview</p>
        <h2 className={styles.title}>{workspaceName} 운영 현황</h2>
        <p className={styles.description}>
          조직 트리, 최근 등록 업무, 주요 담당자 정보를 문서처럼 정리한 개요 화면입니다.
        </p>
      </header>

      <section className={styles.metricsGrid}>
        {summaryCards.map((card) => (
          <article key={card.label} className={styles.metricCard}>
            <p className={styles.metricLabel}>{card.label}</p>
            <strong className={styles.metricValue}>{card.value}</strong>
            <p className={styles.metricDescription}>{card.description}</p>
          </article>
        ))}
      </section>

      <div className={styles.primaryGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Database</p>
              <h3 className={styles.sectionTitle}>조직 현황</h3>
            </div>
            <Link to="/org/manage" className={styles.inlineLink}>
              조직 관리
            </Link>
          </div>

          <ul className={styles.tree}>
            {overview.roots
              .filter((node) => node.nodeType !== 'USER')
              .map((node) => (
                <NodeTree key={node.id} node={node} />
              ))}
          </ul>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Priority</p>
              <h3 className={styles.sectionTitle}>우선 확인할 업무</h3>
            </div>
            <Link to="/work-items/new" className={styles.inlineLink}>
              새 업무
            </Link>
          </div>

          <div className={styles.databaseList}>
            {overview.urgentWorkItems.length > 0 ? (
              overview.urgentWorkItems.map((item) => <WorkItemRow key={item.workItemId} item={item} />)
            ) : (
              <p className={styles.emptyState}>등록된 우선 업무가 없습니다.</p>
            )}
          </div>
        </section>
      </div>

      <div className={styles.secondaryGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Members</p>
              <h3 className={styles.sectionTitle}>루트 권한 사용자</h3>
            </div>
          </div>

          <div className={styles.databaseList}>
            {overview.rootRoleMembers.length > 0 ? (
              overview.rootRoleMembers.map((member) => (
                <article key={member.assignmentId} className={styles.roleRow}>
                  <div className={styles.roleCopy}>
                    <strong>{member.name}</strong>
                    <p className={styles.roleMeta}>
                      {member.userId} · {member.email}
                    </p>
                  </div>
                  <span className={styles.nodeBadge}>{member.roleName}</span>
                </article>
              ))
            ) : (
              <p className={styles.emptyState}>루트 권한 사용자가 없습니다.</p>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Recent</p>
              <h3 className={styles.sectionTitle}>최근 등록된 업무</h3>
            </div>
          </div>

          <div className={styles.databaseList}>
            {overview.recentWorkItems.length > 0 ? (
              overview.recentWorkItems.map((item) => <WorkItemRow key={item.workItemId} item={item} />)
            ) : (
              <p className={styles.emptyState}>최근 등록된 업무가 없습니다.</p>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <div>
              <p className={styles.sectionEyebrow}>Actions</p>
              <h3 className={styles.sectionTitle}>바로 진행할 작업</h3>
            </div>
          </div>

          <div className={styles.actionList}>
            <Link to="/org/manage" className={styles.actionCard}>
              <strong>조직 추가</strong>
              <span>하위 조직을 만들고 담당 범위를 넓힙니다.</span>
            </Link>
            <Link to="/org/manage" className={styles.actionCard}>
              <strong>권한 배치</strong>
              <span>운영에 필요한 권한을 사용자에게 연결합니다.</span>
            </Link>
            <Link to="/work-items/new" className={styles.actionCard}>
              <strong>업무 등록</strong>
              <span>새 작업 페이지를 만들고 일정과 담당자를 입력합니다.</span>
            </Link>
          </div>
        </section>
      </div>
    </section>
  )
}
