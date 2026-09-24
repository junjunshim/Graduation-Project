import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCategoryBadgeStyle, getRecurringCategoryLabel } from '../model/labels'
import { canCreateRecurringRule, canManageRecurringRule } from '../model/recurringRulePermission'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../data/orgService'
import { useKoreanHolidays } from '../model/koreanHolidays'
import type { RecurringRuleRecord } from '../model/recurringRuleTypes'
import { fetchRecurringRules, fetchRecurringRuleDetail, restoreRecurringRule } from '../data/recurringRuleService'
import { formatCycleText, getNextOccurrenceInfo } from '../model/recurringSchedule'
import { RecurringRuleModal } from './RecurringRuleModal'
import { RecurringRuleDetailModal } from './RecurringRuleDetailModal'
import { ConfirmRestoreModal } from './ConfirmRestoreModal'
import { showToast } from '../../notification/data/toastEvents'
import { subscribeToRecurringCache } from '../data/workspaceCacheEvents'
import type { OrganizationNodeRecord, UserRecord } from '../model/types'
import styles from './WorkspaceSchedulesTab.module.css'
import { ScheduleCardRow } from './ScheduleCardRow'

type WorkspaceSchedulesTabProps = {
  activeNodeId?: number
  members?: Array<Pick<UserRecord, 'userId' | 'name'> & Partial<Pick<UserRecord, 'email'>> & { roleName?: string; isTopRole?: boolean }>
  workspaces?: Array<Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'path'>>
}

type FrequencySectionKey = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

const SECTION_CONFIG: Array<{ key: FrequencySectionKey; title: string; icon: string }> = [
  { key: 'DAILY', title: '일간 정기 일정', icon: 'clock' },
  { key: 'WEEKLY', title: '주간 정기 일정', icon: 'calendar' },
  { key: 'MONTHLY', title: '월간 정기 일정', icon: 'fileText' },
  { key: 'YEARLY', title: '연간 정기 일정', icon: 'flag' },
]

export function WorkspaceSchedulesTab({
  activeNodeId = 1,
  members = [],
}: WorkspaceSchedulesTabProps) {
  // 공휴일 데이터가 늦게 도착하면 '다음 발생'을 다시 계산하도록 구독한다.
  const currentYear = new Date().getFullYear()
  const holidayRevision = useKoreanHolidays([currentYear - 1, currentYear, currentYear + 1])
  const [loadedRecurringRules, setLoadedRecurringRules] = useState<RecurringRuleRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showDeletedSchedules, setShowDeletedSchedules] = useState(false)
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false)
  const [selectedRecurringRule, setSelectedRecurringRule] = useState<RecurringRuleRecord | null>(null)
  const [editingRecurringRule, setEditingRecurringRule] = useState<RecurringRuleRecord | null>(null)
  const [restoreConfirmTarget, setRestoreConfirmTarget] = useState<RecurringRuleRecord | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRuleId = searchParams.get('ruleId')

  // 수정/삭제/복구는 서버가 최종 판정하므로, 화면에서도 같은 기준으로 버튼을 막는다.
  const canManageRule = useCallback((rule: RecurringRuleRecord) => {
    const snapshot = getOrgSnapshot()

    return canManageRecurringRule(rule, getCurrentUser(snapshot)?.userId ?? null, snapshot)
  }, [])

  const canManageSelectedRule = useMemo(
    () => (selectedRecurringRule ? canManageRule(selectedRecurringRule) : false),
    [canManageRule, selectedRecurringRule],
  )

  // 일정 생성은 DB create_recurring_rule 과 동일하게 노드의 WI_PERSONAL_CHANGE 가 필요하다.
  const canCreateRule = useMemo(() => {
    const snapshot = getOrgSnapshot()

    return canCreateRecurringRule(activeNodeId, getCurrentUser(snapshot)?.userId ?? null, snapshot)
  }, [activeNodeId])

  useEffect(() => {
    if (!requestedRuleId) return
    let cancelled = false
    const openRequestedRule = async () => {
      const id = Number(requestedRuleId)
      const rule = Number.isSafeInteger(id) && id > 0 ? await fetchRecurringRuleDetail(id) : null
      if (cancelled) return
      if (rule && rule.ownerNodeId === activeNodeId) {
        if (rule.isDeleted) {
          if (canManageRule(rule)) {
            setRestoreConfirmTarget(rule)
          } else {
            showToast({
              title: '복구 권한이 없습니다',
              content: '이 일정을 복구할 권한이 없습니다.',
              created_at: new Date().toISOString(),
            })
          }
        } else {
          setSelectedRecurringRule(rule)
        }
      } else {
        showToast({ title: '일정을 열 수 없습니다', content: '일정이 없거나 조회 권한이 없습니다.', created_at: new Date().toISOString() })
      }
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.delete('ruleId')
        return next
      }, { replace: true })
    }
    void openRequestedRule()
    return () => { cancelled = true }
  }, [requestedRuleId, activeNodeId, setSearchParams, canManageRule])

  const reloadRules = () => {
    if (activeNodeId) {
      setIsLoading(true)
      fetchRecurringRules(activeNodeId, true)
        .then((rules) => {
          setLoadedRecurringRules(rules)
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }

  useEffect(() => {
    reloadRules()

    // 일정 캐시 갱신 이벤트(WorkspacePage의 알림 디스패치 및 로컬 변경 시) 수신 시에만 단일 리로드
    const unsubCache = subscribeToRecurringCache((evt) => {
      if (!evt.nodeId || evt.nodeId === activeNodeId) {
        reloadRules()
      }
    })

    return () => {
      unsubCache()
    }
  }, [activeNodeId])

  const activeRecurringRules = useMemo(
    () => loadedRecurringRules.filter((r) => r.isActive && !r.isDeleted),
    [loadedRecurringRules],
  )

  const deletedRecurringRules = useMemo(
    () => loadedRecurringRules.filter((r) => r.isDeleted),
    [loadedRecurringRules],
  )

  // 휴지통에 항목이 0개가 되면 자동으로 일반 모드로 복귀
  useEffect(() => {
    if (showDeletedSchedules && deletedRecurringRules.length === 0) {
      setShowDeletedSchedules(false)
    }
  }, [showDeletedSchedules, deletedRecurringRules.length])

  const displayedRules = showDeletedSchedules ? deletedRecurringRules : activeRecurringRules

  // 각 일정에 nextOccurrence 정보 계산 및 남은 일수(dDay) 오름차순 정렬
  const enrichedAndSortedRules = useMemo(() => {
    void holidayRevision
    return displayedRules
      .map((rule) => {
        const occ = getNextOccurrenceInfo(rule)
        return {
          ...rule,
          nextOccurrence: occ,
        }
      })
      .sort((a, b) => {
        if (a.nextOccurrence.dDay === null && b.nextOccurrence.dDay === null) return 0
        if (a.nextOccurrence.dDay === null) return 1
        if (b.nextOccurrence.dDay === null) return -1
        return a.nextOccurrence.dDay - b.nextOccurrence.dDay
      })
  }, [displayedRules, holidayRevision])

  // 일/주/월/년 단위로 섹션 그룹핑
  const rulesByFrequency = useMemo(() => {
    const map: Record<FrequencySectionKey, typeof enrichedAndSortedRules> = {
      DAILY: [],
      WEEKLY: [],
      MONTHLY: [],
      YEARLY: [],
    }

    enrichedAndSortedRules.forEach((rule) => {
      if (map[rule.frequency as FrequencySectionKey]) {
        map[rule.frequency as FrequencySectionKey].push(rule)
      } else {
        map.DAILY.push(rule)
      }
    })

    return map
  }, [enrichedAndSortedRules])

  const handleRestoreConfirm = async (cascade: boolean) => {
    if (!restoreConfirmTarget) return
    const target = restoreConfirmTarget

    // 모달이 열린 뒤 권한이 바뀌었을 수 있으므로 제출 직전에 한 번 더 확인한다.
    if (!canManageRule(target)) {
      setRestoreConfirmTarget(null)
      showToast({
        title: '정기 일정 복구 실패',
        content: '정기 일정을 복구할 권한이 없습니다.',
        created_at: new Date().toISOString(),
      })
      return
    }

    try {
      const res = await restoreRecurringRule(target.ruleId, cascade)
      if (res.status === 'success') {
        showToast({
          title: '정기 일정 복구 완료',
          content: cascade
            ? `'${target.title}' 일정과 관련 양식 파일이 정상 복구되었습니다.`
            : `'${target.title}' 일정이 정상 복구되었습니다.`,
          created_at: new Date().toISOString(),
        })
        reloadRules()
      } else {
        showToast({
          title: '정기 일정 복구 실패',
          content: res.message || '일정을 복구하지 못했습니다.',
          created_at: new Date().toISOString(),
        })
      }
    } catch (err) {
      showToast({
        title: '정기 일정 복구 실패',
        content: err instanceof Error ? err.message : '일정을 복구하지 못했습니다.',
        created_at: new Date().toISOString(),
      })
    } finally {
      setRestoreConfirmTarget(null)
    }
  }

  const renderCard = (rule: (typeof enrichedAndSortedRules)[0]) => {
    const canManage = canManageRule(rule)
    const categoryStyle = getCategoryBadgeStyle(rule.category)
    const { dDay, dateString } = rule.nextOccurrence

    const isToday = dDay === 0
    const isSoon = dDay !== null && dDay > 0 && dDay <= 3

    return (
      <div
        key={rule.ruleId}
        className={[
          styles.recurringCard,
          rule.isDeleted ? styles.recurringCardDeleted : '',
        ].join(' ')}
      >
        {/* 상단: D-Day 또는 삭제 상태와 반복 주기 */}
        <div className={styles.cardLeftCol}>
          {rule.isDeleted ? (
            <span className={styles.deletedBadge}>
              <Icon name="trash" size={12} />
              <span>삭제됨</span>
            </span>
          ) : (
            <>
              {dDay !== null ? (
                <span
                  className={[
                    styles.dDayBadge,
                    isToday
                      ? styles.dDayToday
                      : dDay === 1
                        ? styles.dDayTomorrow
                        : isSoon
                          ? styles.dDaySoon
                          : styles.dDayNormal,
                  ].join(' ')}
                >
                  {isToday ? '🔥 오늘 예정' : dDay === 1 ? '⏳ 내일 예정' : `D-${dDay}`}
                </span>
              ) : (
                <span className={[styles.dDayBadge, styles.dDayPast].join(' ')}>만료됨</span>
              )}

              <span className={styles.cycleDisplay} title="반복 설정">
                {formatCycleText(rule)}
              </span>
            </>
          )}
          {rule.isDeleted && (
            <span className={styles.cycleDisplay} title="반복 설정">
              {formatCycleText(rule)}
            </span>
          )}
        </div>

        {/* 본문: 카테고리, 일정명, 설명 */}
        <div className={styles.cardCenterCol}>
          <div className={styles.titleRow}>
            <span
              style={{
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '1px 6px',
                borderRadius: '4px',
                ...categoryStyle,
              }}
            >
              {getRecurringCategoryLabel(rule.category)}
            </span>

            <span className={styles.recurringCardTitle} title={rule.title}>
              {rule.title}
            </span>

          </div>

          {rule.description ? (
            <p className={styles.recurringCardDescription} title={rule.description}>
              {rule.description}
            </p>
          ) : (
            <span style={{ fontSize: '0.74rem', color: 'var(--axis-text-muted)' }}>설명 없음</span>
          )}
        </div>

        {/* 하단: 다음 실행일, 관련 정보와 상세보기/복구 */}
        <div className={styles.cardRightCol}>
          {!rule.isDeleted && (
            <div className={styles.nextRunBlock}>
              <span className={styles.nextRunLabel}>다음 실행일</span>
              <span className={styles.nextRunValue}>{dateString}</span>
            </div>
          )}

          <div className={styles.recurringCardDetails}>
            <span className={styles.metaItem} title="체크리스트 개수">
              <Icon name="checkSquare" size={13} />
              <span>{rule.checklists?.length || 0}</span>
            </span>
            <span className={styles.metaItem} title="첨부 서식 파일 개수">
              <Icon name="page" size={13} />
              <span>{rule.files?.length || 0}</span>
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                color: rule.excludeHolidays ? 'var(--axis-brand-primary)' : 'var(--axis-text-muted)',
                fontWeight: 600,
              }}
              title="공휴일 처리 여부"
            >
              {rule.excludeHolidays ? '공휴일 제외' : '휴일 무시'}
            </span>
          </div>

          <div className={styles.cardActions}>
            {rule.isDeleted ? (
              <button
                type="button"
                className={styles.restoreButton}
                disabled={!canManage}
                title={canManage ? '휴지통에서 복구' : '복구 권한이 없습니다.'}
                onClick={() => setRestoreConfirmTarget(rule)}
              >
                <Icon name="restore" size={13} />
                <span>복구</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedRecurringRule(rule)}
              >
                상세 보기
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className={styles.panel} aria-label="정기 일정 목록">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderTitleGroup}>
          <h2>
            {showDeletedSchedules
              ? `삭제된 정기 일정 (${deletedRecurringRules.length}개)`
              : `정기 / 반복 일정 (${activeRecurringRules.length}개)`}
          </h2>
          <p>
            {showDeletedSchedules
              ? '휴지통에 보관된 정기 일정을 확인하고 복구할 수 있습니다.'
              : '주기적으로 실행되는 업무 및 회의 일정을 일/주/월/년 단위로 확인하고, 다음 실행일을 관리합니다.'}
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={[
              styles.trashToggleBtn,
              showDeletedSchedules ? styles.trashToggleBtnActive : '',
            ].join(' ')}
            disabled={deletedRecurringRules.length === 0}
            onClick={() => {
              if (deletedRecurringRules.length === 0) return
              setShowDeletedSchedules((prev) => !prev)
            }}
            title={
              deletedRecurringRules.length === 0
                ? '휴지통이 비어 있습니다'
                : showDeletedSchedules
                  ? '삭제된 일정 숨기기'
                  : '휴지통 일정 보기'
            }
          >
            <Icon name="trash" size={14} />
            <span>휴지통{deletedRecurringRules.length > 0 ? ` (${deletedRecurringRules.length})` : ''}</span>
          </button>

          {!showDeletedSchedules && (
            <button
              type="button"
              className={styles.primaryButton}
              disabled={!canCreateRule}
              title={canCreateRule ? '새 정기 일정 등록' : '정기 일정을 등록할 권한이 없습니다.'}
              onClick={() => setIsRecurringModalOpen(true)}
            >
              <Icon name="plus" size={14} />
              <span>정기 일정 추가</span>
            </button>
          )}
        </div>
      </header>

      {isLoading ? (
        <div className={styles.emptyState}>
          <Icon name="rotateCcw" size={28} />
          <strong>정기 일정 데이터를 불러오는 중입니다...</strong>
        </div>
      ) : displayedRules.length === 0 ? (
        <div className={styles.emptyState}>
          <Icon name={showDeletedSchedules ? 'trash' : 'rotateCcw'} size={36} />
          <strong>
            {showDeletedSchedules ? '휴지통이 비어 있습니다.' : '등록된 정기 일정이 없습니다.'}
          </strong>
          <span>
            {showDeletedSchedules
              ? '삭제된 정기 일정이 없습니다.'
              : '정기 보고, 정기 점검, 주간 회의 등 반복되는 업무를 등록해 보세요.'}
          </span>
        </div>
      ) : (
        <div className={styles.sectionsContainer} role="region" aria-label="정기 일정 카드 목록" tabIndex={0}>
          {SECTION_CONFIG.map(({ key, title, icon }) => {
            const sectionRules = rulesByFrequency[key]
            if (sectionRules.length === 0) return null

            return (
              <div key={key} className={styles.frequencySection} data-frequency={key}>
                <div className={styles.sectionHeader}>
                  <div className={styles.sectionTitleBadge}>
                    <Icon name={icon as any} size={15} />
                    <span>{title}</span>
                    <span className={styles.sectionCount}>({sectionRules.length})</span>
                  </div>
                  <div className={styles.sectionDivider} />
                </div>

                <ScheduleCardRow title={title}>
                  {sectionRules.map(renderCard)}
                </ScheduleCardRow>
              </div>
            )
          })}
        </div>
      )}

      {/* 정기 일정 등록/수정 모달 */}
      {isRecurringModalOpen && (
        <RecurringRuleModal
          isOpen={isRecurringModalOpen}
          ownerNodeId={activeNodeId}
          initialRule={editingRecurringRule}
          members={members}
          onClose={() => {
            setIsRecurringModalOpen(false)
            setEditingRecurringRule(null)
          }}
          onSuccess={(saved) => {
            // 서버에서 최신 첨부파일/체크리스트 정보 포함하여 재조회
            if (activeNodeId) {
              fetchRecurringRules(activeNodeId).then((rules) => {
                setLoadedRecurringRules(rules)
              })
            } else {
              setLoadedRecurringRules((prev) => {
                const exists = prev.some((r) => r.ruleId === saved.ruleId)
                if (exists) return prev.map((r) => (r.ruleId === saved.ruleId ? saved : r))
                return [saved, ...prev]
              })
            }
            setIsRecurringModalOpen(false)
            setEditingRecurringRule(null)
          }}
        />
      )}

      {/* 정기 일정 상세 모달 */}
      {selectedRecurringRule && (
        <RecurringRuleDetailModal
          isOpen={Boolean(selectedRecurringRule)}
          rule={selectedRecurringRule}
          members={members}
          onClose={() => setSelectedRecurringRule(null)}
          onEdit={(r) => {
            setSelectedRecurringRule(null)
            setEditingRecurringRule(r)
            setIsRecurringModalOpen(true)
          }}
          onDeleted={(ruleId) => {
            setLoadedRecurringRules((prev) =>
              prev.map((r) => (r.ruleId === ruleId ? { ...r, isDeleted: true } : r)),
            )
            setSelectedRecurringRule(null)
          }}
          canEdit={canManageSelectedRule}
          canDelete={canManageSelectedRule}
        />
      )}

      {/* 정기 일정 복구 모달 (업무 복구 모달과 동일하게 파일 복구 여부 선택 지원) */}
      {restoreConfirmTarget && (
        <ConfirmRestoreModal
          isOpen={Boolean(restoreConfirmTarget)}
          title="정기 일정 복구"
          itemName={restoreConfirmTarget.title}
          itemTypeLabel="정기 일정"
          attachedFiles={(restoreConfirmTarget.files || []).map((f) => ({
            id: f.fileId,
            name: f.originalFileName,
            size: f.fileSize,
            workItemTitle: restoreConfirmTarget.title,
          }))}
          onClose={() => setRestoreConfirmTarget(null)}
          onConfirm={handleRestoreConfirm}
        />
      )}
    </section>
  )
}
