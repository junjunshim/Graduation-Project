import { Link, useParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import { getNodeTypeLabel, getWorkItemStatusLabel } from '../../workspace/model/labels'
import styles from './WorkItemEditPage.module.css'

export function WorkItemEditPage() {
  const currentUser = getCurrentUser()
  const { workItemId } = useParams()

  if (!currentUser) {
    return null
  }

  const detail = workItemId ? getSelectedWorkItemDetail(workItemId, currentUser.userId) : null

  if (!detail) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <p className={styles.eyebrow}>Work Item Edit</p>
          <h2 className={styles.title}>수정할 업무를 찾을 수 없습니다.</h2>
          <p className={styles.description}>
            요청한 업무가 없거나 접근할 수 없는 항목입니다. 상세 페이지로 이동 가능한 업무만 수정 진입이 가능합니다.
          </p>
          <Link to="/dashboard" className={styles.primaryAction}>
            대시보드로 돌아가기
          </Link>
        </div>
      </section>
    )
  }

  const { item, ownerNode, ownerUser } = detail

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Work Item Edit</p>
          <h2 className={styles.title}>{item.title} 수정</h2>
          <p className={styles.description}>
            수정 라우트는 준비되었지만 실제 편집 폼과 저장 로직은 아직 연결되지 않았습니다. 현재는 업무 컨텍스트와
            복귀 동선만 제공합니다.
          </p>
        </div>

        <div className={styles.actions}>
          <Link to={`/work-items/${item.workItemId}`} className={styles.primaryAction}>
            상세로 돌아가기
          </Link>
          <Link to="/work-items/new" className={styles.secondaryAction}>
            새 업무 등록
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div>
            <p className={styles.panelEyebrow}>Current Context</p>
            <h3 className={styles.panelTitle}>현재 업무 컨텍스트</h3>
          </div>

          <dl className={styles.contextList}>
            <div className={styles.contextRow}>
              <dt>ID</dt>
              <dd>{item.workItemId}</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>상태</dt>
              <dd>{getWorkItemStatusLabel(item.status)}</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>진행률</dt>
              <dd>{item.progress}%</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>담당자</dt>
              <dd>
                {ownerUser.name} ({ownerUser.userId})
              </dd>
            </div>
            <div className={styles.contextRow}>
              <dt>소유 조직</dt>
              <dd>
                {ownerNode.name}
                <span className={styles.contextSubtext}>{getNodeTypeLabel(ownerNode.nodeType)}</span>
              </dd>
            </div>
            <div className={styles.contextRow}>
              <dt>일정</dt>
              <dd>
                시작 {formatWorkspaceDate(item.startDate)} · 마감 {formatWorkspaceDate(item.dueDate)}
              </dd>
            </div>
          </dl>
        </section>

        <section className={styles.panel}>
          <div>
            <p className={styles.panelEyebrow}>Placeholder</p>
            <h3 className={styles.panelTitle}>향후 수정 화면 자리</h3>
          </div>

          <div className={styles.callout}>
            <strong>다음 단계</strong>
            <p>
              제목, 설명, 상태, 진행률, 일정 변경과 저장 검증은 이 라우트에 연결될 예정입니다. 현재 작업에서는 상세
              페이지에서 수정 진입이 가능하도록 구조만 마련했습니다.
            </p>
          </div>

          <ul className={styles.checkList}>
            <li>상세 페이지에서 수정 진입 경로 유지</li>
            <li>업무 컨텍스트를 잃지 않고 상세로 복귀</li>
            <li>향후 폼 연결 시 사용할 현재 데이터 확인</li>
          </ul>
        </section>
      </div>
    </section>
  )
}
