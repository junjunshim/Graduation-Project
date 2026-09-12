import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { Button } from '../../../design-system/primitives/Button'
import type {
  CreateRecurringRuleRequest,
  HolidayAction,
  RecurringCategory,
  RecurringFrequency,
  RecurringRuleRecord,
  RecurringWeekDay,
} from '../model/recurringRuleTypes'
import { createRecurringRule, deleteRecurringRuleFile, updateRecurringRule } from '../data/recurringRuleService'
import { showToast } from '../../notification/data/toastEvents'
import type { UserRecord } from '../model/types'
import styles from './RecurringRuleModal.module.css'

export type RecurringRuleMemberItem = Pick<UserRecord, 'userId' | 'name'> & {
  roleName?: string
  email?: string
  isTopRole?: boolean
}

export type RecurringRuleModalProps = {
  isOpen: boolean
  ownerNodeId: number
  initialRule?: RecurringRuleRecord | null
  members: RecurringRuleMemberItem[]
  onClose: () => void
  onSuccess: (rule: RecurringRuleRecord) => void
}

const CATEGORY_OPTIONS: Array<{ value: RecurringCategory; label: string }> = [
  { value: 'ROUTINE', label: '정기 루틴' },
  { value: 'REPORT', label: '정기 보고' },
  { value: 'INSPECTION', label: '시스템 점검' },
  { value: 'MEETING', label: '정기 회의' },
  { value: 'EVENT', label: '조직 행사' },
]

const FREQUENCY_OPTIONS: Array<{ value: RecurringFrequency; label: string }> = [
  { value: 'DAILY', label: '매일' },
  { value: 'WEEKLY', label: '매주' },
  { value: 'MONTHLY', label: '매월' },
  { value: 'YEARLY', label: '매년' },
]

const WEEK_DAYS: Array<{ value: RecurringWeekDay; label: string }> = [
  { value: 'MO', label: '월' },
  { value: 'TU', label: '화' },
  { value: 'WE', label: '수' },
  { value: 'TH', label: '목' },
  { value: 'FR', label: '금' },
  { value: 'SA', label: '토' },
  { value: 'SU', label: '일' },
]

export function RecurringRuleModal({
  isOpen,
  ownerNodeId,
  initialRule,
  members,
  onClose,
  onSuccess,
}: RecurringRuleModalProps) {
  const isEdit = Boolean(initialRule)

  // 기본 정보 상태
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<RecurringCategory>('ROUTINE')
  const [assigneeUserId, setAssigneeUserId] = useState<string>('')

  // 반복 주기 속성
  const [frequency, setFrequency] = useState<RecurringFrequency>('WEEKLY')
  const [intervalValue, setIntervalValue] = useState<number>(1)
  const [selectedDays, setSelectedDays] = useState<Set<RecurringWeekDay>>(new Set(['MO']))
  const [byMonthDay, setByMonthDay] = useState<number>(1)

  // 시간 및 기간
  const [startTime, setStartTime] = useState<string>('09:00')
  const [durationMinutes, setDurationMinutes] = useState<number>(60)
  const [repeatStartDate, setRepeatStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [repeatEndDate, setRepeatEndDate] = useState<string>('')

  // 공휴일 예외 처리
  const [excludeHolidays, setExcludeHolidays] = useState<boolean>(true)
  const [holidayAction, setHolidayAction] = useState<HolidayAction>('SKIP')

  // 체크리스트
  const [checklists, setChecklists] = useState<Array<{ content: string; sortOrder: number }>>([])
  const [newChecklistText, setNewChecklistText] = useState('')

  // 첨부 파일
  const [existingFiles, setExistingFiles] = useState<RecurringRuleRecord['files']>([])
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 초기값 동기화
  useEffect(() => {
    if (!isOpen) return

    if (initialRule) {
      setTitle(initialRule.title)
      setDescription(initialRule.description || '')
      setCategory(initialRule.category)
      setAssigneeUserId(initialRule.assigneeUserId || '')
      setFrequency(initialRule.frequency)
      setIntervalValue(initialRule.intervalValue || 1)
      if (initialRule.byDay) {
        setSelectedDays(new Set(initialRule.byDay.split(',') as RecurringWeekDay[]))
      } else {
        setSelectedDays(new Set(['MO']))
      }
      setByMonthDay(initialRule.byMonthDay || 1)
      setStartTime(initialRule.startTime ? initialRule.startTime.slice(0, 5) : '09:00')
      setDurationMinutes(initialRule.durationMinutes || 60)
      setRepeatStartDate(initialRule.repeatStartDate ? initialRule.repeatStartDate.slice(0, 10) : new Date().toISOString().slice(0, 10))
      setRepeatEndDate(initialRule.repeatEndDate ? initialRule.repeatEndDate.slice(0, 10) : '')
      setExcludeHolidays(initialRule.excludeHolidays)
      setHolidayAction(initialRule.holidayAction)
      setChecklists(
        (initialRule.checklists || []).map((c, i) => ({
          content: c.content,
          sortOrder: c.sortOrder ?? i,
        })),
      )
      setExistingFiles(initialRule.files || [])
    } else {
      setTitle('')
      setDescription('')
      setCategory('ROUTINE')
      setAssigneeUserId('')
      setFrequency('WEEKLY')
      setIntervalValue(1)
      setSelectedDays(new Set(['MO']))
      setByMonthDay(1)
      setStartTime('09:00')
      setDurationMinutes(60)
      setRepeatStartDate(new Date().toISOString().slice(0, 10))
      setRepeatEndDate('')
      setExcludeHolidays(true)
      setHolidayAction('SKIP')
      setChecklists([])
      setExistingFiles([])
    }
    setAttachedFiles([])
    setErrorMessage(null)
  }, [isOpen, initialRule])

  if (!isOpen || typeof document === 'undefined') return null

  const handleToggleDay = (day: RecurringWeekDay) => {
    setSelectedDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) {
        if (next.size > 1) next.delete(day)
      } else {
        next.add(day)
      }
      return next
    })
  }

  const handleAddChecklist = () => {
    if (!newChecklistText.trim()) return
    setChecklists((prev) => [
      ...prev,
      { content: newChecklistText.trim(), sortOrder: prev.length },
    ])
    setNewChecklistText('')
  }

  const handleRemoveChecklist = (index: number) => {
    setChecklists((prev) => prev.filter((_, i) => i !== index))
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...Array.from(e.target.files!)])
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setErrorMessage('일정 제목을 입력해 주세요.')
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const byDayString = frequency === 'WEEKLY' ? Array.from(selectedDays).join(',') : undefined

      if (isEdit && initialRule) {
        const res = await updateRecurringRule(
          {
            ruleId: initialRule.ruleId,
            title: title.trim(),
            description: description.trim(),
            category,
            assigneeUserId: assigneeUserId || null,
            frequency,
            intervalValue: Number(intervalValue) || 1,
            byDay: byDayString,
            byMonthDay: frequency === 'MONTHLY' ? Number(byMonthDay) : undefined,
            startTime: startTime ? `${startTime}:00` : undefined,
            durationMinutes: Number(durationMinutes) || 60,
            repeatStartDate,
            repeatEndDate: repeatEndDate || null,
            excludeHolidays,
            holidayAction,
            checklists,
          },
          attachedFiles,
        )
        if (res.status === 'success' && res.rule) {
          showToast({
            title: '정기 일정 수정 완료',
            content: `'${res.rule.title}' 일정이 성공적으로 수정되었습니다.`,
            created_at: new Date().toISOString(),
          })
          onSuccess(res.rule)
          onClose()
        } else {
          setErrorMessage(res.message || '정기 일정을 수정하지 못했습니다.')
        }
      } else {
        const payload: CreateRecurringRuleRequest = {
          ownerNodeId,
          title: title.trim(),
          description: description.trim(),
          category,
          assigneeUserId: assigneeUserId || undefined,
          frequency,
          intervalValue: Number(intervalValue) || 1,
          byDay: byDayString,
          byMonthDay: frequency === 'MONTHLY' ? Number(byMonthDay) : undefined,
          startTime: startTime ? `${startTime}:00` : undefined,
          durationMinutes: Number(durationMinutes) || 60,
          repeatStartDate,
          repeatEndDate: repeatEndDate || undefined,
          excludeHolidays,
          holidayAction,
          checklists,
        }
        const res = await createRecurringRule(payload, attachedFiles)
        if (res.status === 'success' && res.rule) {
          showToast({
            title: '정기 일정 생성 완료',
            content: `'${res.rule.title}' 일정이 성공적으로 등록되었습니다.`,
            created_at: new Date().toISOString(),
          })
          onSuccess(res.rule)
          onClose()
        } else {
          setErrorMessage(res.message || '정기 일정을 등록하지 못했습니다.')
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '오류가 발생했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Icon name="rotateCcw" size={18} />
            </div>
            <h3 className={styles.title}>{isEdit ? '정기 일정 수정' : '새 정기 일정 등록'}</h3>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className={styles.content}>
          {errorMessage && (
            <div style={{ color: '#ef4444', fontSize: '0.85rem', background: 'rgba(239, 68, 68, 0.1)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
              {errorMessage}
            </div>
          )}

          {/* 1. 기본 정보 */}
          <div className={styles.formGroup}>
            <label className={styles.label}>
              일정 제목 <span className={styles.required}>*</span>
            </label>
            <input
              type="text"
              className={styles.input}
              placeholder="예: 주간 스프린트 회의, 분기별 서버 점검..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className={styles.row}>
            <div className={styles.col}>
              <label className={styles.label}>유형 (카테고리)</label>
              <select
                className={styles.select}
                value={category}
                onChange={(e) => setCategory(e.target.value as RecurringCategory)}
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.col}>
              <label className={styles.label}>기본 담당자</label>
              <select
                className={styles.select}
                value={assigneeUserId}
                onChange={(e) => setAssigneeUserId(e.target.value)}
              >
                <option value="">미지정 (공용)</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} {m.roleName ? `(${m.roleName})` : `(${m.userId})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label className={styles.label}>설명 / 실행 가이드</label>
            <textarea
              className={styles.textarea}
              placeholder="일정 목적 및 사전 준비 사항을 입력하세요."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* 2. 반복 주기 설정 */}
          <div className={styles.formGroup}>
            <label className={styles.label}>반복 주기</label>
            <div className={styles.segmentedButtons}>
              {FREQUENCY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={[
                    styles.segmentBtn,
                    frequency === opt.value ? styles.segmentBtnActive : '',
                  ].join(' ')}
                  onClick={() => setFrequency(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.col}>
              <label className={styles.label}>반복 간격</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className={styles.input}
                  style={{ width: '80px' }}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(Math.max(1, Number(e.target.value)))}
                />
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  {frequency === 'DAILY' && '일마다'}
                  {frequency === 'WEEKLY' && '주마다'}
                  {frequency === 'MONTHLY' && '개월마다'}
                  {frequency === 'YEARLY' && '년마다'}
                </span>
              </div>
            </div>

            {frequency === 'WEEKLY' && (
              <div className={styles.col} style={{ flex: 2 }}>
                <label className={styles.label}>반복 요일</label>
                <div className={styles.dayButtonGroup}>
                  {WEEK_DAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      className={[
                        styles.dayBtn,
                        selectedDays.has(d.value) ? styles.dayBtnSelected : '',
                      ].join(' ')}
                      onClick={() => handleToggleDay(d.value)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {frequency === 'MONTHLY' && (
              <div className={styles.col}>
                <label className={styles.label}>매월 일자</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className={styles.input}
                    style={{ width: '80px' }}
                    value={byMonthDay}
                    onChange={(e) => setByMonthDay(Math.min(31, Math.max(1, Number(e.target.value))))}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>일</span>
                </div>
              </div>
            )}
          </div>

          {/* 3. 시간 및 유효 기간 */}
          <div className={styles.row}>
            <div className={styles.col}>
              <label className={styles.label}>시작 시간</label>
              <input
                type="time"
                className={styles.input}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className={styles.col}>
              <label className={styles.label}>소요 시간 (분)</label>
              <input
                type="number"
                min={15}
                step={15}
                className={styles.input}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.col}>
              <label className={styles.label}>반복 시작 기준일</label>
              <input
                type="date"
                className={styles.input}
                value={repeatStartDate}
                onChange={(e) => setRepeatStartDate(e.target.value)}
                required
              />
            </div>
            <div className={styles.col}>
              <label className={styles.label}>종료일 (선택)</label>
              <input
                type="date"
                className={styles.input}
                value={repeatEndDate}
                min={repeatStartDate}
                placeholder="무기한"
                onChange={(e) => setRepeatEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* 4. 고도화된 공휴일 처리 정책 */}
          <div className={styles.holidayCard}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={excludeHolidays}
                onChange={(e) => setExcludeHolidays(e.target.checked)}
              />
              <span>법정 공휴일 예외 정책 적용</span>
            </label>

            {excludeHolidays && (
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="holiday_action"
                    value="SKIP"
                    checked={holidayAction === 'SKIP'}
                    onChange={() => setHolidayAction('SKIP')}
                  />
                  <span>
                    <strong>건너뜀 (SKIP)</strong>: 공휴일 회차는 자동으로 생략합니다. (회의, 일상 루틴 권장)
                  </span>
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="holiday_action"
                    value="NEXT_WORKDAY"
                    checked={holidayAction === 'NEXT_WORKDAY'}
                    onChange={() => setHolidayAction('NEXT_WORKDAY')}
                  />
                  <span>
                    <strong>다음 영업일로 순연 (NEXT_WORKDAY)</strong>: 다음 평일에 실행합니다. (정기 점검 권장)
                  </span>
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="holiday_action"
                    value="PREV_WORKDAY"
                    checked={holidayAction === 'PREV_WORKDAY'}
                    onChange={() => setHolidayAction('PREV_WORKDAY')}
                  />
                  <span>
                    <strong>직전 영업일로 앞당김 (PREV_WORKDAY)</strong>: 직전 평일로 당겨 마감합니다. (정기 결산/보고서 제출 권장)
                  </span>
                </label>
              </div>
            )}
          </div>

          {/* 5. 체크리스트 템플릿 */}
          <div className={styles.checklistSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>체크리스트 템플릿</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>업무 인스턴스화 시 자동 이식됩니다.</span>
            </div>
            <div className={styles.checklistInputRow}>
              <input
                type="text"
                className={styles.input}
                placeholder="세부 점검 항목 입력 (예: 서버 백업 정상 완료 확인)"
                value={newChecklistText}
                onChange={(e) => setNewChecklistText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddChecklist()
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={handleAddChecklist}>
                추가
              </Button>
            </div>
            {checklists.length > 0 && (
              <div className={styles.checklistItemList}>
                {checklists.map((c, i) => (
                  <div key={i} className={styles.checklistItem}>
                    <span className={styles.checkItemText}>
                      <Icon name="checkSquare" size={14} />
                      {c.content}
                    </span>
                    <button
                      type="button"
                      className={styles.removeItemBtn}
                      onClick={() => handleRemoveChecklist(i)}
                      aria-label="항목 삭제"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 6. 공통 템플릿 파일 첨부 (드래그앤드롭) */}
          <div className={styles.fileSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>공통 템플릿 및 양식 첨부</span>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>매뉴얼, 보고서 양식 등을 등록합니다.</span>
            </div>
            <div
              className={[styles.dropzone, isDragging ? styles.dropzoneActive : ''].join(' ')}
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                multiple
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <Icon name="folder" size={24} />
              <span className={styles.dropzoneText}>파일을 마우스로 끌어다 놓거나 클릭하여 선택하세요.</span>
              <span className={styles.dropzoneSub}>PDF, DOCX, XLSX 등 양식 파일 지원</span>
            </div>

            {/* 기존 등록된 서버 파일 목록 */}
            {existingFiles && existingFiles.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  기존 등록된 파일 ({existingFiles.length}개)
                </span>
                <div className={styles.fileList}>
                  {existingFiles.map((file) => (
                    <div key={file.fileId} className={styles.fileItem}>
                      <span className={styles.fileItemLeft}>
                        <Icon name="page" size={14} />
                        <span>{file.originalFileName}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                          ({(file.fileSize / 1024).toFixed(1)} KB)
                        </span>
                      </span>
                      <button
                        type="button"
                        className={styles.removeItemBtn}
                        onClick={async () => {
                          if (!window.confirm(`'${file.originalFileName}' 파일을 삭제하시겠습니까?`)) return
                          await deleteRecurringRuleFile(file.fileId)
                          setExistingFiles((prev) => (prev || []).filter((f) => f.fileId !== file.fileId))
                          showToast({
                            title: '파일 삭제 완료',
                            content: `'${file.originalFileName}' 파일이 삭제되었습니다.`,
                            created_at: new Date().toISOString(),
                          })
                        }}
                        aria-label="기존 파일 삭제"
                        title="파일 삭제"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 새로 추가할 파일 목록 */}
            {attachedFiles.length > 0 && (
              <div style={{ marginTop: '0.5rem' }}>
                <span style={{ fontSize: '0.78rem', color: '#6366f1', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  새로 추가할 파일 ({attachedFiles.length}개)
                </span>
                <div className={styles.fileList}>
                  {attachedFiles.map((file, idx) => (
                    <div key={idx} className={styles.fileItem}>
                      <span className={styles.fileItemLeft}>
                        <Icon name="page" size={14} />
                        <span>{file.name}</span>
                        <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>
                          ({(file.size / 1024).toFixed(1)} KB)
                        </span>
                      </span>
                      <button
                        type="button"
                        className={styles.removeItemBtn}
                        onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="파일 삭제"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </form>

        <footer className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isSubmitting}>
            취소
          </button>
          <button
            type="button"
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={isSubmitting || !title.trim()}
          >
            {isSubmitting ? (
              <span>저장 중...</span>
            ) : (
              <>
                <Icon name="checkCircle" size={15} />
                <span>{isEdit ? '수정 완료' : '정기 일정 등록'}</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
