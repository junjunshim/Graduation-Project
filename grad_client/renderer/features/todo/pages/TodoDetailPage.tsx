import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getTodoById } from '../api'
import { TodoPropertyList } from '../components/TodoPropertyList'
import { TodoStatusBadge } from '../components/TodoStatusBadge'
import styles from './TodoPage.module.css'

const detailCopy = {
  planned: {
    summary: '아직 시작 전 단계입니다. 필요한 자료와 체크포인트를 먼저 정리해 두면 착수 속도가 좋아집니다.',
    actions: ['작업 시작 조건을 확인하기', '필요한 자료를 미리 모아두기', '다음 검토 일정을 캘린더에 반영하기'],
  },
  'in-progress': {
    summary: '현재 진행중인 작업입니다. 진행 상황과 다음 액션을 분명히 남겨 두면 회의 전 공유가 쉬워집니다.',
    actions: ['현재 진행률을 한 줄로 요약하기', '막히는 지점을 문서에 남기기', '다음 산출물 마감일을 확정하기'],
  },
  done: {
    summary: '완료된 항목입니다. 결과물과 회고 포인트를 남겨 두면 이후 데모와 정리 문서에 바로 활용할 수 있습니다.',
    actions: ['최종 결과물을 링크로 연결하기', '완료 기준을 기록하기', '후속 작업이 있으면 새 항목으로 분리하기'],
  },
} as const

export function TodoDetailPage() {
  const { todoId } = useParams()
  const todo = todoId ? getTodoById(todoId) : undefined

  if (!todo) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>할 일을 찾을 수 없어요.</h2>
          <p className={styles.emptyText}>선택한 항목이 없거나 잘못된 주소로 들어왔습니다.</p>
          <Link to="/todos" className={styles.primaryAction}>
            데이터베이스로 돌아가기
          </Link>
        </div>
      </section>
    )
  }

  const narrative = detailCopy[todo.status]

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Page</p>
          <h1 className={styles.title}>{todo.title}</h1>
          <p className={styles.description}>{todo.description}</p>
        </div>

        <div className={styles.headerActions}>
          <TodoStatusBadge status={todo.status} />
          <Link to="/todos" className={styles.secondaryAction}>
            <Icon name="database" size={16} />
            <span>데이터베이스로 돌아가기</span>
          </Link>
        </div>
      </header>

      <div className={styles.detailGrid}>
        <article className={styles.documentCard}>
          <div className={styles.documentHeader}>
            <span className={styles.documentIcon}>
              <Icon name="page" size={18} />
            </span>
            <div>
              <p className={styles.panelEyebrow}>Document</p>
              <h2 className={styles.panelTitle}>작업 메모</h2>
            </div>
          </div>

          <section className={styles.noteBlock}>
            <h3 className={styles.blockTitle}>현재 상태</h3>
            <p className={styles.blockText}>{narrative.summary}</p>
          </section>

          <section className={styles.noteBlock}>
            <h3 className={styles.blockTitle}>다음 액션</h3>
            <ul className={styles.checkList}>
              {narrative.actions.map((action) => (
                <li key={action} className={styles.checkItem}>
                  <span className={styles.checkMark}>
                    <Icon name="checkCircle" size={14} />
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ul>
          </section>
        </article>

        <aside className={styles.detailSidebar}>
          <section className={styles.sideCard}>
            <p className={styles.panelEyebrow}>Properties</p>
            <h2 className={styles.panelTitle}>속성</h2>
            <TodoPropertyList todo={todo} />
          </section>

          <section className={styles.sideCard}>
            <p className={styles.panelEyebrow}>Tip</p>
            <h2 className={styles.panelTitle}>정리 포인트</h2>
            <p className={styles.sideText}>
              페이지 설명, 상태, 마감일을 같은 형식으로 유지하면 홈 대시보드와 데이터베이스에서
              같은 정보 구조를 그대로 재사용할 수 있습니다.
            </p>
          </section>
        </aside>
      </div>
    </section>
  )
}
