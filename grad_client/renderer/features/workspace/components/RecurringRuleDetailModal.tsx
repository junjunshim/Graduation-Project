import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCategoryBadgeStyle, getRecurringCategoryLabel } from '../model/labels'
import type { RecurringRuleRecord } from '../model/recurringRuleTypes'
import { deleteRecurringRule } from '../data/recurringRuleService'
import { showToast } from '../../notification/data/toastEvents'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import type { UserRecord } from '../model/types'
import styles from './RecurringRuleDetailModal.module.css'

export type RecurringRuleDetailModalProps = {
  isOpen: boolean
  rule: RecurringRuleRecord | null
  members?: Array<Pick<UserRecord, 'userId' | 'name'> & { roleName?: string }>
  onClose: () => void
  /** 수정/삭제 액션. 대시보드처럼 상세만 볼 때는 넘기지 않으며, 그때는 버튼이 숨겨진다. */
  onEdit?: (rule: RecurringRuleRecord) => void
  onDeleted?: (ruleId: number) => void
  /** 수정/삭제 대신 노출하는 '일정 목록으로 이동' 액션 */
  onNavigateToList?: () => void
  /** 수정 권한이 없으면 버튼을 비활성화한다 (기본: 허용) */
  canEdit?: boolean
  /** 삭제 권한이 없으면 버튼을 비활성화한다 (기본: 허용) */
  canDelete?: boolean
}

const NO_EDIT_PERMISSION_HINT = '수정 권한이 없습니다.'
const NO_DELETE_PERMISSION_HINT = '삭제 권한이 없습니다.'

const HOLIDAY_ACTIONS: Record<string, string> = {
  SKIP: '건너뜀 (SKIP)',
  NEXT_WORKDAY: '다음 영업일 순연',
  PREV_WORKDAY: '직전 영업일 앞당김',
}

export function RecurringRuleDetailModal({
  isOpen,
  rule,
  members = [],
  onClose,
  onEdit,
  onDeleted,
  onNavigateToList,
  canEdit = true,
  canDelete = true,
}: RecurringRuleDetailModalProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [localFiles, setLocalFiles] = useState(rule?.files || [])

  // rule 변경 시 localFiles 동기화
  useEffect(() => {
    if (rule) {
      setLocalFiles(rule.files || [])
    }
  }, [rule])

  if (!isOpen || !rule || typeof document === 'undefined') return null

  const formatMember = (userId?: string | null, fallback = '') => {
    const member = members.find((m) => m.userId === userId)

    if (member) {
      return `${member.name}${member.roleName ? ` (${member.roleName})` : ''}`
    }

    return userId || fallback
  }

  const assigneeDisplay = formatMember(rule.assigneeUserId, '미지정 (공용)')
  const creatorDisplay = formatMember(rule.creatorUserId, '알 수 없음')

  const categoryStyle = getCategoryBadgeStyle(rule.category)
  const categoryLabel = getRecurringCategoryLabel(rule.category)

  const getCycleText = () => {
    let base = ''
    if (rule.frequency === 'DAILY') base = rule.intervalValue === 1 ? '매일' : `${rule.intervalValue}일마다`
    else if (rule.frequency === 'WEEKLY') {
      const days = rule.byDay ? `(${rule.byDay})` : ''
      base = rule.intervalValue === 1 ? `매주 ${days}` : `${rule.intervalValue}주마다 ${days}`
    } else if (rule.frequency === 'MONTHLY') {
      const day = rule.byMonthDay ? `${rule.byMonthDay}일` : ''
      base = rule.intervalValue === 1 ? `매월 ${day}` : `${rule.intervalValue}개월마다 ${day}`
    } else {
      base = rule.intervalValue === 1 ? '매년' : `${rule.intervalValue}년마다`
    }
    return base
  }

  const handleDelete = () => {
    setIsConfirmDeleteOpen(true)
  }

  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    try {
      const res = await deleteRecurringRule(rule.ruleId)
      if (res.status === 'success') {
        showToast({
          title: '정기 일정 삭제 완료',
          content: `'${rule.title}' 일정이 성공적으로 삭제되어 휴지통으로 이동되었습니다.`,
          created_at: new Date().toISOString(),
        })
        onDeleted?.(rule.ruleId)
        onClose()
      } else {
        setErrorMessage(res.message || '삭제에 실패했습니다.')
      }
    } finally {
      setIsDeleting(false)
      setIsConfirmDeleteOpen(false)
    }
  }

  return createPortal(
    <>
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <Icon name="rotateCcw" size={18} />
              <h3 className={styles.title}>{rule.title}</h3>
            </div>
            <button type="button" className={styles.closeButton} onClick={onClose} aria-label="닫기">
              <Icon name="close" size={16} />
            </button>
          </header>

        <div className={styles.content}>
          {errorMessage && (
            <div style={{ color: 'var(--axis-status-danger)', fontSize: '0.85rem', background: 'var(--axis-status-danger-soft)', padding: '0.6rem 0.8rem', borderRadius: '6px' }}>
              {errorMessage}
            </div>
          )}

          <div className={styles.badgeRow}>
            <span className={styles.categoryBadge} style={categoryStyle}>
              {categoryLabel}
            </span>
            <span className={styles.cycleBadge}>↻ {getCycleText()}</span>
          </div>

          {rule.description && <p className={styles.desc}>{rule.description}</p>}

          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>실행 시간</span>
              <span className={styles.metaValue}>
                {rule.startTime ? rule.startTime.slice(0, 5) : '시간 미지정'}{' '}
                {rule.durationMinutes ? `(${rule.durationMinutes}분)` : ''}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>유효 기간</span>
              <span className={styles.metaValue}>
                {rule.repeatStartDate.slice(0, 10)} ~ {rule.repeatEndDate ? rule.repeatEndDate.slice(0, 10) : '무기한'}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>생성자</span>
              <span className={styles.metaValue}>
                {creatorDisplay}
              </span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>기본 담당자</span>
              <span className={styles.metaValue}>
                {assigneeDisplay}
              </span>
            </div>
            <div className={`${styles.metaItem} ${styles.metaItemWide}`}>
              <span className={styles.metaLabel}>공휴일 정책</span>
              <span className={styles.metaValue}>
                {rule.excludeHolidays ? HOLIDAY_ACTIONS[rule.holidayAction] : '휴일 무시'}
              </span>
            </div>
          </div>

          {rule.checklists && rule.checklists.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>
                체크리스트 템플릿 ({rule.checklists.length}개)
              </span>
              <div className={styles.list}>
                {rule.checklists.map((c, i) => (
                  <div key={i} className={styles.listItem}>
                    <Icon name="checkSquare" size={14} />
                    <span>{c.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {localFiles && localFiles.length > 0 && (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>
                공통 양식 파일 ({localFiles.length}개)
              </span>
              <div className={styles.list}>
                {localFiles.map((f, i) => (
                  <div key={i} className={styles.fileItem}>
                    <div className={styles.fileItemLeft}>
                      <Icon name="page" size={15} />
                      <span title={f.originalFileName}>{f.originalFileName}</span>
                      <span style={{ color: 'var(--axis-text-muted)', fontSize: '0.72rem' }}>
                        ({(f.fileSize / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.leftActions}>
            {onNavigateToList ? (
              <button type="button" className={styles.editBtn} onClick={onNavigateToList}>
                일정 목록으로 이동
              </button>
            ) : null}

            {onDeleted ? (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={handleDelete}
                disabled={isDeleting || !canDelete}
                title={canDelete ? undefined : NO_DELETE_PERMISSION_HINT}
              >
                삭제
              </button>
            ) : null}

            {onEdit ? (
              <button
                type="button"
                className={styles.editBtn}
                onClick={() => {
                  onEdit(rule)
                  onClose()
                }}
                disabled={!canEdit}
                title={canEdit ? undefined : NO_EDIT_PERMISSION_HINT}
              >
                수정
              </button>
            ) : null}
          </div>

          <div className={styles.rightActions}>
            <button
              type="button"
              className={styles.closeFooterBtn}
              onClick={onClose}
            >
              닫기
            </button>
          </div>
        </footer>
      </div>
    </div>

    {isConfirmDeleteOpen && (
      <ConfirmDeleteModal
        isOpen={isConfirmDeleteOpen}
        title="정기 일정 삭제"
        itemName={rule.title}
        itemTypeLabel="정기 일정"
        warningText="일정을 삭제하면 휴지통으로 이동하며, 반복 일정 목록에서 비활성화됩니다."
        attachedFiles={(localFiles || []).map((f) => ({
          id: f.fileId,
          name: f.originalFileName,
          size: f.fileSize,
          workItemTitle: rule.title,
        }))}
        onClose={() => setIsConfirmDeleteOpen(false)}
        onConfirm={handleDeleteConfirm}
      />
    )}
  </>,
  document.body,
)
}
