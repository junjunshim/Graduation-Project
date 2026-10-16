import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCategoryBadgeStyle, getRecurringCategoryLabel, RECURRING_CATEGORY_OPTIONS } from '../model/labels'
import { canCreateRecurringRule, canManageRecurringRule } from '../model/recurringRulePermission'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../data/orgService'
import { useKoreanHolidays } from '../model/koreanHolidays'
import type { RecurringCategory, RecurringRuleRecord } from '../model/recurringRuleTypes'
import {
  fetchRecurringRules,
  fetchRecurringRuleDetail,
  getLocalRecurringRules,
  hasLoadedRecurringRulesForNode,
  restoreRecurringRule,
} from '../data/recurringRuleService'
import { formatRepeatSummary, getNextOccurrenceInfo } from '../model/recurringSchedule'
import { RecurringRuleModal } from './RecurringRuleModal'
import { RecurringRuleDetailModal } from './RecurringRuleDetailModal'
import { ConfirmRestoreModal } from './ConfirmRestoreModal'
import { showToast } from '../../notification/data/toastEvents'
import { subscribeToRecurringCache } from '../data/workspaceCacheEvents'
import type { OrganizationNodeRecord, UserRecord } from '../model/types'
import styles from './WorkspaceSchedulesTab.module.css'

type WorkspaceSchedulesTabProps = {
  activeNodeId?: number
  members?: Array<Pick<UserRecord, 'userId' | 'name'> & Partial<Pick<UserRecord, 'email'>> & { roleName?: string; isTopRole?: boolean }>
  workspaces?: Array<Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'path'>>
}

type FrequencySectionKey = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

const SECTION_CONFIG: Array<{ key: FrequencySectionKey; title: string; countLabel: string; icon: string }> = [
  { key: 'DAILY', title: '일간', countLabel: '일간', icon: 'rotateCcw' },
  { key: 'WEEKLY', title: '주간', countLabel: '주간', icon: 'calendar' },
  { key: 'MONTHLY', title: '월간', countLabel: '월간', icon: 'fileText' },
  { key: 'YEARLY', title: '연간', countLabel: '연간', icon: 'flag' },
]

const KOREAN_DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']

function formatNextDateDisplay(date: Date | null, fallback: string): string {
  if (!date) return fallback
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const dayName = KOREAN_DAY_NAMES[date.getDay()]
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${m}.${d} (${dayName}) ${hh}:${mm}`
}

function formatCycleWithTime(rule: RecurringRuleRecord): string {
  const summary = formatRepeatSummary(rule)
  const time = rule.startTime ? rule.startTime.slice(0, 5) : ''
  return time ? `${summary} ${time}` : summary
}

function formatHolidayPolicyLabel(rule: RecurringRuleRecord): string {
  if (!rule.excludeHolidays) {
    return '휴일 포함'
  }
  switch (rule.holidayAction) {
    case 'NEXT_WORKDAY':
      return '공휴일 제외 (다음 영업일)'
    case 'PREV_WORKDAY':
      return '공휴일 제외 (직전 영업일)'
    case 'SKIP':
    default:
      return '공휴일 제외 (건너뜀)'
  }
}

export function WorkspaceSchedulesTab({
  activeNodeId = 1,
  members = [],
}: WorkspaceSchedulesTabProps) {
  // 공휴일 데이터가 늦게 도착하면 '다음 발생'을 다시 계산하도록 구독한다.
  const currentYear = new Date().getFullYear()
  const holidayRevision = useKoreanHolidays([currentYear - 1, currentYear, currentYear + 1])
  const [loadedRecurringRules, setLoadedRecurringRules] = useState<RecurringRuleRecord[]>(() => {
    return activeNodeId ? getLocalRecurringRules(activeNodeId, true) : []
  })
  const [isLoading, setIsLoading] = useState(() => {
    if (!activeNodeId) return false
    const cached = getLocalRecurringRules(activeNodeId, true)
    return cached.length === 0 && !hasLoadedRecurringRulesForNode(activeNodeId)
  })
  const [showDeletedSchedules, setShowDeletedSchedules] = useState(false)
  const [isRecurringModalOpen, setIsRecurringModalOpen] = useState(false)
  const [selectedRecurringRule, setSelectedRecurringRule] = useState<RecurringRuleRecord | null>(null)
  const [editingRecurringRule, setEditingRecurringRule] = useState<RecurringRuleRecord | null>(null)
  const [restoreConfirmTarget, setRestoreConfirmTarget] = useState<RecurringRuleRecord | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRuleId = searchParams.get('ruleId')

  // 검색 및 카테고리 필터 상태
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<'all' | RecurringCategory>('all')
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)

  // 외부 클릭 시 카테고리 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setIsCategoryDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const reloadRules = useCallback((nodeId?: number) => {
    const targetNodeId = nodeId ?? activeNodeId
    if (!targetNodeId) return

    const cached = getLocalRecurringRules(targetNodeId, true)
    if (cached.length > 0) {
      setLoadedRecurringRules(cached)
    } else if (!hasLoadedRecurringRulesForNode(targetNodeId)) {
      setIsLoading(true)
    }

    fetchRecurringRules(targetNodeId, true)
      .then((rules) => {
        setLoadedRecurringRules(rules)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [activeNodeId])

  useEffect(() => {
    // 노드가 변경되었을 때 즉시 해당 노드의 캐시를 우선 반영
    if (activeNodeId) {
      const cached = getLocalRecurringRules(activeNodeId, true)
      setLoadedRecurringRules(cached)
      if (cached.length === 0 && !hasLoadedRecurringRulesForNode(activeNodeId)) {
        setIsLoading(true)
      }
    }
    reloadRules(activeNodeId)

    // 일정 캐시 갱신 이벤트 수신 시 단일 리로드
    const unsubCache = subscribeToRecurringCache((evt) => {
      if (!evt.nodeId || evt.nodeId === activeNodeId) {
        reloadRules(activeNodeId)
      }
    })

    return () => {
      unsubCache()
    }
  }, [activeNodeId, reloadRules])

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

  // 검색어 및 카테고리 필터 적용
  const filteredRules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return displayedRules.filter((rule) => {
      if (categoryFilter !== 'all' && rule.category !== categoryFilter) {
        return false
      }
      if (q) {
        const matchTitle = rule.title.toLowerCase().includes(q)
        const matchDesc = rule.description ? rule.description.toLowerCase().includes(q) : false
        if (!matchTitle && !matchDesc) return false
      }
      return true
    })
  }, [displayedRules, searchQuery, categoryFilter])

  // 각 일정에 nextOccurrence 정보 계산 및 남은 일수(dDay) 오름차순 정렬 (오늘과 가장 가까운 순서)
  const enrichedAndSortedRules = useMemo(() => {
    void holidayRevision
    return filteredRules
      .map((rule) => {
        const occ = getNextOccurrenceInfo(rule)
        return {
          ...rule,
          nextOccurrence: occ,
        }
      })
      .sort((a, b) => {
        // dDay가 null(만료/종료)인 것은 뒤로
        if (a.nextOccurrence.dDay === null && b.nextOccurrence.dDay === null) return 0
        if (a.nextOccurrence.dDay === null) return 1
        if (b.nextOccurrence.dDay === null) return -1
        if (a.nextOccurrence.dDay !== b.nextOccurrence.dDay) {
          return a.nextOccurrence.dDay - b.nextOccurrence.dDay
        }
        // dDay가 같다면 nextDate 시간 오름차순
        const aTime = a.nextOccurrence.nextDate?.getTime() ?? 0
        const bTime = b.nextOccurrence.nextDate?.getTime() ?? 0
        return aTime - bTime
      })
  }, [filteredRules, holidayRevision])

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
    const { dDay, nextDate, dateString } = rule.nextOccurrence

    const isToday = dDay === 0

    return (
      <div
        key={rule.ruleId}
        className={[
          styles.recurringCard,
          rule.isDeleted ? styles.recurringCardDeleted : '',
        ].join(' ')}
      >
        {/* 상단: 카테고리 뱃지 & D-Day 뱃지 */}
        <div className={styles.cardHeaderRow}>
          <span
            className={styles.categoryBadge}
            style={categoryStyle}
          >
            {getRecurringCategoryLabel(rule.category)}
          </span>

          {rule.isDeleted ? (
            <span className={styles.deletedBadge}>
              <Icon name="trash" size={11} />
              <span>삭제됨</span>
            </span>
          ) : dDay !== null ? (
            <span
              className={[
                styles.dDayBadge,
                isToday ? styles.dDayToday : styles.dDayNormal,
              ].join(' ')}
            >
              {isToday ? '오늘' : `D-${dDay}`}
            </span>
          ) : (
            <span className={[styles.dDayBadge, styles.dDayPast].join(' ')}>만료됨</span>
          )}
        </div>

        {/* 본문: 제목 및 설명 */}
        <div className={styles.cardBody}>
          <h3 className={styles.cardTitle} title={rule.title}>
            {rule.title}
          </h3>

          <p className={styles.cardDescription} title={rule.description || ''}>
            {rule.description || '일정에 대한 설명이 등록되지 않았습니다.'}
          </p>
        </div>

        {/* 주기 표시 문구 */}
        <div className={styles.cycleTextRow}>
          <Icon name="rotateCcw" size={13} className={styles.cycleIcon} />
          <span>{formatCycleWithTime(rule)}</span>
        </div>

        {/* 다음 실행일 정보 */}
        {!rule.isDeleted && (
          <div className={styles.nextOccurrenceBox}>
            <span className={styles.nextOccurrenceLabel}>다음 실행일</span>
            <strong className={styles.nextOccurrenceValue}>
              {formatNextDateDisplay(nextDate, dateString)}
            </strong>
          </div>
        )}

        {/* 하단 메타 정보 (체크리스트, 첨부파일, 공휴일) */}
        <div className={styles.cardFooter}>
          <div className={styles.metaChipsCol}>
            <div className={styles.metaChipsRow}>
              <span className={styles.metaChip} title="체크리스트">
                <Icon name="checkSquare" size={12} />
                <span>체크리스트 {rule.checklists?.length || 0}개</span>
              </span>

              <span className={styles.metaChip} title="첨부 서식 파일">
                <Icon name="fileText" size={12} />
                <span>첨부파일 {rule.files?.length || 0}개</span>
              </span>
            </div>

            <div className={styles.metaChipsRow}>
              <span className={styles.metaChip} title="공휴일 처리 정책">
                <Icon name="calendar" size={11} />
                <span>{formatHolidayPolicyLabel(rule)}</span>
              </span>
            </div>
          </div>

          <div className={styles.cardActionArea}>
            {rule.isDeleted ? (
              <button
                type="button"
                className={styles.restoreBtn}
                disabled={!canManage}
                title={canManage ? '휴지통에서 복구' : '복구 권한이 없습니다.'}
                onClick={() => setRestoreConfirmTarget(rule)}
              >
                <Icon name="restore" size={12} />
                <span>복구</span>
              </button>
            ) : (
              <button
                type="button"
                className={styles.detailLinkBtn}
                onClick={() => setSelectedRecurringRule(rule)}
              >
                <span>상세 보기</span>
                <span className={styles.arrowIcon}>→</span>
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const selectedCategoryLabel = categoryFilter === 'all'
    ? '카테고리 전체'
    : RECURRING_CATEGORY_OPTIONS.find((c) => c.value === categoryFilter)?.label ?? categoryFilter

  return (
    <section className={styles.panel} aria-label="정기 일정 목록">
      {/* 상단 헤더 */}
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
          {/* 검색창 */}
          <div className={styles.searchBox}>
            <Icon name="search" size={14} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="일정 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className={styles.searchClearBtn}
                onClick={() => setSearchQuery('')}
                title="검색어 지우기"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>

          {/* 카테고리 필터 드롭다운 */}
          <div className={styles.filterDropdownWrapper} ref={categoryDropdownRef}>
            <button
              type="button"
              className={[
                styles.filterDropdownBtn,
                isCategoryDropdownOpen ? styles.filterDropdownBtnActive : '',
                categoryFilter !== 'all' ? styles.filterDropdownBtnFiltered : '',
              ].join(' ')}
              onClick={() => setIsCategoryDropdownOpen((prev) => !prev)}
            >
              <span>{selectedCategoryLabel}</span>
              <Icon
                name="chevronDown"
                size={12}
                className={[
                  styles.dropdownChevron,
                  isCategoryDropdownOpen ? styles.dropdownChevronOpen : '',
                ].join(' ')}
              />
            </button>

            {isCategoryDropdownOpen && (
              <div className={styles.filterDropdownMenu}>
                <button
                  type="button"
                  className={[
                    styles.dropdownMenuItem,
                    categoryFilter === 'all' ? styles.dropdownMenuItemActive : '',
                  ].join(' ')}
                  onClick={() => {
                    setCategoryFilter('all')
                    setIsCategoryDropdownOpen(false)
                  }}
                >
                  <span>전체</span>
                </button>
                {RECURRING_CATEGORY_OPTIONS.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    className={[
                      styles.dropdownMenuItem,
                      categoryFilter === cat.value ? styles.dropdownMenuItemActive : '',
                    ].join(' ')}
                    onClick={() => {
                      setCategoryFilter(cat.value)
                      setIsCategoryDropdownOpen(false)
                    }}
                  >
                    <span>{cat.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 휴지통 버튼 */}
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
            <span>휴지통 ({deletedRecurringRules.length})</span>
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
        /* 4열 세로 스택 컬럼 그리드 */
        <div className={styles.columnsGrid} role="region" aria-label="정기 일정 컬럼 목록">
          {SECTION_CONFIG.map(({ key, countLabel, icon }) => {
            const sectionRules = rulesByFrequency[key]

            return (
              <div key={key} className={styles.columnCard} data-frequency={key}>
                {/* 컬럼 헤더 */}
                <div className={styles.columnHeader}>
                  <div className={styles.columnHeaderTitleGroup}>
                    <Icon name={icon as any} size={15} className={styles.columnIcon} />
                    <span className={styles.columnTitleText}>{countLabel}</span>
                    <span className={styles.columnCountBadge}>{sectionRules.length}</span>
                  </div>
                </div>

                {/* 컬럼 바디 (개별 내부 세로 스크롤) */}
                <div className={styles.columnBody}>
                  {sectionRules.length === 0 ? (
                    <div className={styles.columnEmpty}>
                      <span>
                        {showDeletedSchedules ? '삭제된' : '등록된'} {countLabel} 일정이 없습니다.
                      </span>
                    </div>
                  ) : (
                    sectionRules.map(renderCard)
                  )}
                </div>
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
