import type { WorkItemComposerContext } from '../../workspace/model/types'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreateSidebarProps = {
  composer: WorkItemComposerContext
  form: WorkItemCreateFormState
}

export function WorkItemCreateSidebar({ composer, form }: WorkItemCreateSidebarProps) {
  // 필수 입력 항목 실시간 충족 여부
  const hasTitle = Boolean(form.title.trim())
  const hasNode = Boolean(form.ownerNodeId)
  const hasAssignee = Boolean(form.ownerUserId)
  const hasDueDate = Boolean(form.dueDate)

  const checklist = [
    { label: '업무 제목 입력', valid: hasTitle, required: true },
    { label: '담당 조직(노드) 지정', valid: hasNode, required: true },
    { label: '담당자 배정', valid: hasAssignee, required: true },
    { label: '마감 일정 설정', valid: hasDueDate, required: false },
    { label: '상위 업무 연결', valid: Boolean(form.parentWorkItemId), required: false },
    { label: '업무 설명 작성', valid: Boolean(form.description.trim()), required: false },
  ]

  const requiredCount = checklist.filter((item) => item.required).length
  const completedRequiredCount = checklist.filter((item) => item.required && item.valid).length
  const completionRate = Math.round((completedRequiredCount / requiredCount) * 100)

  return (
    <div className={styles.sidebarWrapper}>
      {/* 1. 필수 작성 체크리스트 */}
      <section className={styles.sideCard}>
        <div className={styles.sideCardHeader}>
          <h4 className={styles.sideCardTitle}>작성 진행도</h4>
          <span className={styles.completionBadge} data-complete={completionRate === 100}>
            {completionRate}%
          </span>
        </div>
        <div className={styles.progressBarBg}>
          <div className={styles.progressBarFill} style={{ width: `${completionRate}%` }} />
        </div>
        <ul className={styles.checklist}>
          {checklist.map((item, idx) => (
            <li key={idx} className={styles.checklistItem} data-valid={item.valid}>
              <span className={styles.checkIcon}>{item.valid ? '✓' : '○'}</span>
              <span className={styles.checkLabel}>
                {item.label}
                {item.required ? <i className={styles.required}>*</i> : <small className={styles.optional}>(선택)</small>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* 2. 발급 예정 정보 */}
      <section className={styles.sideCard}>
        <h4 className={styles.sideCardTitle}>업무 등록 정보</h4>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>업무 고유 식별자</span>
            <span className={styles.metaValueBadge}>{composer.suggestedWorkItemId}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>선택된 조직</span>
            <strong className={styles.metaValue}>{composer.selectedNode?.name ?? '미지정'}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>카테고리 / 공개여부</span>
            <strong className={styles.metaValue}>
              {form.categoryId ? form.categoryId.toUpperCase() : '미분류'} · {form.hidden ? '🔒 숨김 업무' : '🌐 일반 공개'}
            </strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>조직 계층 경로</span>
            <span className={styles.metaValuePath}>{composer.pathLabel}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>담당자 배속 풀</span>
            <strong className={styles.metaValue}>{composer.assignableUsers.length}명 참여 가능</strong>
          </div>
        </div>
      </section>

      {/* 3. 작성 가이드 팁 */}
      <section className={styles.sideCard}>
        <h4 className={styles.sideCardTitle}>💡 작성 가이드</h4>
        <ul className={styles.tipsList}>
          <li>목표와 산출물이 명확히 드러나도록 제목을 간결하게 작성하세요.</li>
          <li>조직을 변경하면 해당 조직의 팀원들로 담당자 목록이 즉시 변경됩니다.</li>
          <li>상위 프로젝트가 있는 경우 연결해 두면 조직도와 타임라인에서 한눈에 추적됩니다.</li>
        </ul>
      </section>
    </div>
  )
}

