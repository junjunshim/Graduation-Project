import type { FormEvent } from 'react'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'
import { WORK_ITEM_STATUS_OPTIONS } from '../../workspace/model/options'
import type { WorkItemComposerContext, WorkItemStatus } from '../../workspace/model/types'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreateFormProps = {
  composer: WorkItemComposerContext
  form: WorkItemCreateFormState
  submitting: boolean
  feedback: { tone: 'error' | 'success'; message: string } | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onFieldChange: <Key extends keyof WorkItemCreateFormState>(
    field: Key,
    value: WorkItemCreateFormState[Key],
  ) => void
}

export function WorkItemCreateForm({
  composer,
  form,
  submitting,
  feedback,
  onSubmit,
  onFieldChange,
}: WorkItemCreateFormProps) {
  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.panelEyebrow}>Basic</p>
          <h3 className={styles.panelTitle}>업무 기본 정보</h3>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>업무 제목</span>
          <input
            className={styles.input}
            value={form.title}
            onChange={(event) => onFieldChange('title', event.target.value)}
            placeholder="업무 제목을 입력해 주세요"
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>설명</span>
          <textarea
            className={styles.textarea}
            value={form.description}
            onChange={(event) => onFieldChange('description', event.target.value)}
            placeholder="업무 목적, 산출물, 참고 사항을 입력해 주세요"
          />
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.panelEyebrow}>Properties</p>
          <h3 className={styles.panelTitle}>조직과 담당자</h3>
        </div>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>담당 조직</span>
            <select
              className={styles.input}
              value={form.ownerNodeId}
              onChange={(event) => onFieldChange('ownerNodeId', event.target.value)}
            >
              {composer.availableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>담당자</span>
            <select
              className={styles.input}
              value={form.ownerUserId}
              onChange={(event) => onFieldChange('ownerUserId', event.target.value)}
            >
              {composer.assignableUsers.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.name} ({user.userId})
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={styles.field}>
          <span className={styles.label}>상위 업무</span>
          <select
            className={styles.input}
            value={form.parentWorkItemId}
            onChange={(event) => onFieldChange('parentWorkItemId', event.target.value)}
          >
            <option value="">없음</option>
            {composer.availableParentItems.map((item) => (
              <option key={item.workItemId} value={item.workItemId}>
                {item.workItemId} · {item.title}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.panelEyebrow}>Schedule</p>
          <h3 className={styles.panelTitle}>상태와 일정</h3>
        </div>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>상태</span>
            <select
              className={styles.input}
              value={form.status}
              onChange={(event) => onFieldChange('status', event.target.value as WorkItemStatus)}
            >
              {WORK_ITEM_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {getWorkItemStatusLabel(status)}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>시작일</span>
            <input
              type="date"
              className={styles.input}
              value={form.startDate}
              onChange={(event) => onFieldChange('startDate', event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>마감일</span>
            <input
              type="date"
              className={styles.input}
              value={form.dueDate}
              onChange={(event) => onFieldChange('dueDate', event.target.value)}
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <p className={styles.panelEyebrow}>Progress</p>
          <h3 className={styles.panelTitle}>우선순위와 진행 값</h3>
        </div>

        <div className={styles.fieldGridThree}>
          <label className={styles.field}>
            <span className={styles.label}>우선순위 (1-5)</span>
            <input
              type="number"
              min={1}
              max={5}
              className={styles.input}
              value={form.priority}
              onChange={(event) => onFieldChange('priority', event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>가중치 (0 이상)</span>
            <input
              type="number"
              min={0}
              className={styles.input}
              value={form.weight}
              onChange={(event) => onFieldChange('weight', event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>진행률 (0-100)</span>
            <input
              type="number"
              min={0}
              max={100}
              className={styles.input}
              value={form.progress}
              onChange={(event) => onFieldChange('progress', event.target.value)}
            />
          </label>
        </div>
      </section>

      <p className={styles.helperText}>
        일정과 진행 값은 저장 전에 자동 검증됩니다. 마감일은 시작일보다 빠를 수 없습니다.
      </p>

      {feedback ? (
        <div
          className={[
            styles.feedback,
            feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
          ].join(' ')}
        >
          {feedback.message}
        </div>
      ) : null}

      <div className={styles.submitRow}>
        <button type="submit" className={styles.submitButton} disabled={submitting}>
          {submitting ? '등록 중...' : '업무 등록'}
        </button>
      </div>
    </form>
  )
}
