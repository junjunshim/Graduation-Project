import type { FormEvent } from 'react'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'
import { WORK_ITEM_STATUS_OPTIONS } from '../../workspace/model/options'
import type { WorkItemComposerContext, WorkItemStatus } from '../../workspace/model/types'
import { WORK_ITEM_TAGS } from '../../workspace/model/workItemTags'
import type { WorkItemTagId } from '../../workspace/model/workItemTags'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreateFormProps = {
  composer: WorkItemComposerContext
  form: WorkItemCreateFormState
  submitting: boolean
  feedback: { tone: 'error' | 'success'; message: string } | null
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  submitLabel?: string
  submittingLabel?: string
  categoryRequired?: boolean
  categorySupported?: boolean
  dueDateRequired?: boolean
  ownerLocked?: boolean
  submitDisabled?: boolean
  onFieldChange: <Key extends keyof WorkItemCreateFormState>(
    field: Key,
    value: WorkItemCreateFormState[Key],
  ) => void
}

const priorityOptions = [
  { value: '5', symbol: '↓↓', label: '매우 낮음', tone: 'lowest' },
  { value: '4', symbol: '↓', label: '낮음', tone: 'low' },
  { value: '3', symbol: '−', label: '보통', tone: 'medium' },
  { value: '2', symbol: '↑', label: '높음', tone: 'high' },
  { value: '1', symbol: '↑↑', label: '매우 높음', tone: 'highest' },
] as const

export function WorkItemCreateForm({
  composer,
  form,
  submitting,
  feedback,
  onSubmit,
  onCancel,
  submitLabel = '업무 생성',
  submittingLabel = '생성 중...',
  categoryRequired = true,
  categorySupported = true,
  dueDateRequired = true,
  ownerLocked = false,
  submitDisabled = false,
  onFieldChange,
}: WorkItemCreateFormProps) {
  const hasSelectedOwner = composer.assignableUsers.some(
    (user) => user.userId === form.ownerUserId,
  )

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.formGridTwo}>
        <label className={styles.field}>
          <span className={styles.label}>업무 제목 <i>*</i></span>
          <input
            className={styles.input}
            value={form.title}
            onChange={(event) => onFieldChange('title', event.target.value)}
            placeholder="업무 제목을 입력하세요"
            required
          />
        </label>

        <label className={styles.field}>
          <span className={styles.label}>
            카테고리 {categoryRequired && categorySupported ? <i>*</i> : null}
          </span>
          <select
            className={styles.input}
            value={form.categoryId}
            onChange={(event) => onFieldChange('categoryId', event.target.value as WorkItemTagId)}
            required={categoryRequired && categorySupported}
            disabled={!categorySupported}
          >
            <option value="" disabled={categorySupported}>
              {categorySupported ? '카테고리를 선택하세요' : '현재 서버 API에서 지원하지 않습니다'}
            </option>
            {categorySupported
              ? Object.entries(WORK_ITEM_TAGS).map(([categoryId, category]) => (
                  <option key={categoryId} value={categoryId}>{category.label}</option>
                ))
              : null}
          </select>
        </label>
      </div>

      <div className={styles.assignmentRow}>
        <label className={styles.field}>
          <span className={styles.label}>담당자 {!ownerLocked ? <i>*</i> : null}</span>
          <select
            className={styles.input}
            value={form.ownerUserId}
            onChange={(event) => onFieldChange('ownerUserId', event.target.value)}
            required={!ownerLocked}
            disabled={ownerLocked}
          >
            {!hasSelectedOwner && form.ownerUserId ? (
              <option value={form.ownerUserId}>{form.ownerUserId}</option>
            ) : null}
            {composer.assignableUsers.map((user) => (
              <option key={user.userId} value={user.userId}>{user.name} ({user.userId})</option>
            ))}
          </select>
        </label>

        <fieldset className={styles.priorityField}>
          <legend className={styles.label}>우선순위 <i>*</i></legend>
          <div className={styles.priorityOptions}>
            {priorityOptions.map((option) => (
              <label
                key={option.value}
                className={styles.priorityOption}
                data-tone={option.tone}
                data-selected={form.priority === option.value}
              >
                <input
                  type="radio"
                  name="priority"
                  value={option.value}
                  checked={form.priority === option.value}
                  onChange={(event) => onFieldChange('priority', event.target.value)}
                />
                <strong>{option.symbol}</strong>
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className={styles.formGridThree}>
        <label className={styles.field}>
          <span className={styles.label}>상태 <i>*</i></span>
          <select
            className={styles.input}
            value={form.status}
            onChange={(event) => onFieldChange('status', event.target.value as WorkItemStatus)}
          >
            {WORK_ITEM_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{getWorkItemStatusLabel(status)}</option>
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
          <span className={styles.label}>마감일 {dueDateRequired ? <i>*</i> : null}</span>
          <input
            type="date"
            className={styles.input}
            value={form.dueDate}
            onChange={(event) => onFieldChange('dueDate', event.target.value)}
            required={dueDateRequired}
          />
        </label>
      </div>

      <label className={[styles.field, styles.descriptionField].join(' ')}>
        <span className={styles.label}>업무 설명</span>
        <textarea
          className={styles.textarea}
          value={form.description}
          onChange={(event) => onFieldChange('description', event.target.value)}
          placeholder="업무에 대한 설명을 입력하세요."
        />
      </label>

      <div className={[styles.field, styles.attachmentField].join(' ')}>
        <span className={styles.label}>첨부파일</span>
        <div className={styles.attachmentPlaceholder} aria-disabled="true">
          <strong>↥</strong>
          <span>파일을 드래그하거나 클릭하여 추가하세요.</span>
          <small>이미지, 문서, 스프레드시트, 압축파일 (최대 10MB)</small>
        </div>
      </div>

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
        <button type="button" className={styles.cancelButton} onClick={onCancel} disabled={submitting}>
          취소
        </button>
        <button type="submit" className={styles.submitButton} disabled={submitting || submitDisabled}>
          {submitting ? submittingLabel : submitLabel}
        </button>
      </div>
    </form>
  )
}
