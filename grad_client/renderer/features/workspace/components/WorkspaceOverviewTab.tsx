import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { getNodeVisualMetadata } from '../queries/workspaceDirectory'
import { formatActivityMessage } from '../../dashboard/model/activityFormatter'
import { getActivityLink } from '../../dashboard/model/activityLink'
import { resolveActivityEntities } from '../../dashboard/model/resolveActivityEntity'
import { analyzeWorkspaceMembers } from '../model/memberInheritance'
import { getRoleBadgeStyle, getWorkItemStatusLabel } from '../model/labels'
import type { WorkspaceOverview, WorkspaceSnapshot } from '../model/types'
import type { RecurringRuleRecord } from '../model/recurringRuleTypes'
import { fetchRecurringRules, getLocalRecurringRules, hasLoadedRecurringRulesForNode } from '../data/recurringRuleService'
import { subscribeToRecurringCache } from '../data/workspaceCacheEvents'
import { getSchedulesForCalendarDate } from '../model/recurringCalendar'
import { useKoreanHolidays } from '../model/koreanHolidays'
import { getWorkspaceTodayTimestamp } from '../model/workItemDue'
import { buildWorkspaceOverviewTaskSummary } from '../model/workspaceOverviewSummary'
import {
  canViewHistory,
  canViewMembers,
  canViewParentNode,
  canViewSchedule,
  canViewSubNodes,
  canViewWorkItems,
  canViewWorkItemDetail,
} from '../model/effectiveAuthority'
import styles from './WorkspaceOverviewTab.module.css'

const FREQUENCY_LABELS: Record<RecurringRuleRecord['frequency'], string> = {
  DAILY: '일간',
  WEEKLY: '주간',
  MONTHLY: '월간',
  YEARLY: '연간',
}

function Panel({ title, icon, href, children, bodyClassName = '' }: { title: string; icon: IconName; href?: string; children: ReactNode; bodyClassName?: string }) {
  return <section className={styles.panel}>
    <header className={styles.header}><h3><Icon name={icon} size={22} />{title}</h3>{href && <Link to={href}>전체 보기 <Icon name="chevronRight" size={15} /></Link>}</header>
    <div className={`${styles.body} ${bodyClassName}`} role="region" aria-label={title} tabIndex={0}>{children}</div>
  </section>
}

export function WorkspaceOverviewTab({ overview, snapshot, currentUserId }: {
  overview: WorkspaceOverview; snapshot: WorkspaceSnapshot; currentUserId: string
}) {
  const node = overview.rootNode
  const nodeId = node?.id
  const [rules, setRules] = useState<RecurringRuleRecord[]>(() => {
    return node ? getLocalRecurringRules(node.id, true) : []
  })
  const [loading, setLoading] = useState(() => {
    if (!node) return false
    const cached = getLocalRecurringRules(node.id, true)
    return cached.length === 0 && !hasLoadedRecurringRulesForNode(node.id)
  })
  const [error, setError] = useState(false)
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    setSelectedScheduleDate(null)
    if (nodeId !== undefined) {
      const cached = getLocalRecurringRules(nodeId, true)
      setRules(cached)
      if (cached.length === 0 && !hasLoadedRecurringRulesForNode(nodeId)) {
        setLoading(true)
      }
    }
    let requestId = 0
    const reload = async () => {
      const request = ++requestId
      const cached = nodeId !== undefined ? getLocalRecurringRules(nodeId, true) : []
      if (cached.length === 0 && nodeId !== undefined && !hasLoadedRecurringRulesForNode(nodeId)) {
        setLoading(true)
      }
      setError(false)
      try {
        const next = nodeId !== undefined ? await fetchRecurringRules(nodeId, true) : []
        if (!disposed && request === requestId) setRules(next)
      } catch {
        if (!disposed && request === requestId) setError(true)
      } finally {
        if (!disposed && request === requestId) setLoading(false)
      }
    }
    void reload()
    const unsubscribe = subscribeToRecurringCache((event) => {
      if (!event.nodeId || event.nodeId === nodeId) void reload()
    })
    return () => { disposed = true; unsubscribe() }
  }, [nodeId])

  const href = (view: string) => `/workspace?view=${view}${node ? `&nodeId=${node.id}` : ''}`
  const members = useMemo(
    () => analyzeWorkspaceMembers({
      rootNode: node,
      nodes: snapshot.nodes,
      roles: snapshot.roles,
      users: snapshot.users,
      authorities: snapshot.authorities,
    }).all,
    [node, snapshot.authorities, snapshot.nodes, snapshot.roles, snapshot.users],
  )
  const memberByUserId = useMemo(
    () => new Map(members.map((member) => [member.userId, member])),
    [members],
  )
  const userById = useMemo(
    () => new Map(snapshot.users.map((user) => [user.userId, user])),
    [snapshot.users],
  )
  const managers = useMemo(
    () => members.filter((member) => member.isDirect && member.isTopRole),
    [members],
  )
  const myMembership = memberByUserId.get(currentUserId)
  const myRole = myMembership?.effectiveRoleName
  const parent = useMemo(
    () => snapshot.nodes.find((candidate) => candidate.id === node?.parentNodeId && !candidate.isDeleted),
    [node?.parentNodeId, snapshot.nodes],
  )
  const children = useMemo(
    () => snapshot.nodes.filter((candidate) => node && candidate.parentNodeId === node.id && !candidate.isDeleted),
    [node, snapshot.nodes],
  )
  const resolveUserName = (id: string) => memberByUserId.get(id)?.name || userById.get(id)?.name
  const userName = (id: string) => resolveUserName(id) || '미지정'
  const todayTimestamp = getWorkspaceTodayTimestamp()
  const today = new Date(todayTimestamp).toISOString().slice(0, 10)
  // 일정 패널도 공휴일 정책을 반영하므로, 공휴일 데이터가 늦게 도착하면 이번 주 일정을 다시 계산한다.
  const scheduleYear = Number(today.slice(0, 4))
  const holidayRevision = useKoreanHolidays([scheduleYear - 1, scheduleYear, scheduleYear + 1])
  const taskSummary = useMemo(
    () => buildWorkspaceOverviewTaskSummary(overview.visibleWorkItems, todayTimestamp),
    [overview.visibleWorkItems, todayTimestamp],
  )
  const {
    tasks,
    pending,
    priorityTasks,
    overdueCount,
    completedCount,
    inProgressCount,
    todoCount,
    completionRate,
  } = taskSummary
  const weekDays = useMemo(() => {
    const weekStart = new Date(`${today}T00:00:00Z`)
    weekStart.setUTCDate(weekStart.getUTCDate() - (weekStart.getUTCDay() + 6) % 7)

    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart)
      date.setUTCDate(date.getUTCDate() + index)
      const key = date.toISOString().slice(0, 10)
      return { key, day: date.getUTCDate(), label: ['월', '화', '수', '목', '금', '토', '일'][index], schedules: getSchedulesForCalendarDate(rules, key) }
    })
    // 공휴일 데이터가 늦게 도착하면 주간 일정의 휴일 정책도 다시 계산해야 한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holidayRevision, rules, today])
  const selectedDate = selectedScheduleDate ?? today
  const selectedSchedules = weekDays.find((day) => day.key === selectedDate)?.schedules ?? []
  const activities = useMemo(
    () =>
      resolveActivityEntities(overview.activities ?? [], rules, snapshot.workItems)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id),
    [overview.activities, rules, snapshot.workItems],
  )

  const canViewTasks = node ? canViewWorkItems(currentUserId, node.id, snapshot) : false
  const canViewSched = node ? canViewSchedule(currentUserId, node.id, snapshot) : false
  const canViewHist = node ? canViewHistory(currentUserId, node.id, snapshot) : false
  const canViewMemb = node ? canViewMembers(currentUserId, node.id, snapshot) : false
  const canViewParent = node ? canViewParentNode(currentUserId, node.id, snapshot) : false
  const canViewSub = node ? canViewSubNodes(currentUserId, node.id, snapshot) : false

  return <div className={styles.grid}>
    <section className={styles.panel} aria-label="워크스페이스 현황">
      <header className={styles.header}><h3><Icon name="building" size={22} />워크스페이스 현황</h3></header>
      <div className={styles.introduction}>
        <div className={styles.summary} tabIndex={0} role="region" aria-label="업무 현황">
          {canViewTasks ? (
            <>
              <span className={styles.statTotal}><span className={styles.statLabel}><Icon name="list" size={16} />전체</span><b>{tasks.length}</b></span>
              <span className={styles.statProgress}><span className={styles.statLabel}><Icon name="clock" size={16} />진행 중</span><b>{inProgressCount}</b></span>
              <span className={styles.statDone}><span className={styles.statLabel}><Icon name="checkCircle" size={16} />완료</span><b>{completedCount}</b></span>
              <span className={styles.statOverdue}><span className={styles.statLabel}><Icon name="alertTriangle" size={16} />기한 초과</span><b>{overdueCount}</b></span>
            </>
          ) : (
            <div className={styles.statRestricted}>
              <Icon name="lock" size={16} />
              <span>업무 조회 권한이 없어 통계가 표시되지 않습니다.</span>
            </div>
          )}
        </div>
      <div className={styles.hierarchy} tabIndex={0} role="region" aria-label="상하위 워크스페이스">
        <div className={styles.hierarchyContent}>
        <section className={styles.hierarchyColumn} aria-label="상위 워크스페이스">
        <span className={styles.muted}>상위</span>
        {!canViewParent ? (
          <div className={styles.hierarchyRestricted}>
            <Icon name="lock" size={18} />
            <span>상위 노드 조회 권한 없음</span>
          </div>
        ) : parent ? (
          <Link className={styles.parentCard} to={`/workspace?nodeId=${parent.id}`}>
            <Icon name={getNodeVisualMetadata(parent.nodeType).iconName} size={28} />
            <strong>{parent.name}</strong>
          </Link>
        ) : (
          <div className={styles.parentCard}><span className={styles.muted}>상위 워크스페이스 없음</span></div>
        )}
        </section>
        <section className={styles.hierarchyColumn} aria-label="하위 워크스페이스">
        <span className={styles.muted}>하위 · {canViewSub ? `${children.length}개` : '권한 필요'}</span>
        {!canViewSub ? (
          <div className={styles.hierarchyRestricted}>
            <Icon name="lock" size={18} />
            <span>하위 노드 조회 권한 없음</span>
          </div>
        ) : (
          <div className={styles.children} role="region" aria-label="하위 워크스페이스 목록" tabIndex={0}>
            {children.length ? children.map((child) => <Link key={child.id} to={`/workspace?nodeId=${child.id}`}><Icon name={getNodeVisualMetadata(child.nodeType).iconName} size={18} />{child.name}</Link>) : <span className={styles.muted}>하위 워크스페이스 없음</span>}
          </div>
        )}
        </section>
        </div>
      </div>
      <dl className={styles.facts} tabIndex={0} aria-label="워크스페이스 참여 정보">
        <dt>관리자</dt>
        <dd>
          {!canViewMemb ? (
            <span className={styles.muted}>조회 권한 없음</span>
          ) : managers.length ? (
            managers.map((manager) => <span className={styles.person} key={manager.userId}><UserAvatar name={manager.name} userId={manager.userId} size="medium" />{manager.name}</span>)
          ) : (
            '등록된 관리자 없음'
          )}
        </dd>
        <dt>참여 인원</dt>
        <dd>
          <span className={styles.factIcon}><Icon name="users" size={18} /></span>
          {!canViewMemb ? <span className={styles.muted}>조회 권한 없음</span> : `${members.length}명`}
        </dd>
        <dt>내 역할</dt><dd><span className={styles.factIcon}><Icon name="star" size={18} /></span>{myRole ? <span className={styles.roleBadge} style={getRoleBadgeStyle(myRole, myMembership?.isTopRole)}>{myRole}</span> : '지정된 역할 없음'}</dd>
      </dl>
      </div>
    </section>
    <Panel title="일정" icon="calendar" href={canViewSched ? href('schedules') : undefined} bodyClassName={!canViewSched ? styles.fullHeightBody : styles.scheduleBody}>
      {!canViewSched ? (
        <div className={styles.permissionRestricted}>
          <Icon name="lock" size={24} />
          <strong>일정 조회 권한이 없습니다</strong>
          <span>이 워크스페이스의 정기 일정을 보려면 일정 조회 권한이 필요합니다.</span>
        </div>
      ) : (
        <>
          <div className={styles.weekHeading}><strong>이번 주 <span>{Number(weekDays[0].key.slice(5, 7))}.{weekDays[0].day} – {Number(weekDays[6].key.slice(5, 7))}.{weekDays[6].day}</span></strong><span className={styles.muted}>반복 주기 기준</span></div>
          <div className={styles.weekStrip} role="group" aria-label="이번 주 일정 날짜 선택">
            {weekDays.map((day) => {
              const count = day.schedules.length
              return <button key={day.key} type="button" className={styles.weekDay} aria-pressed={selectedDate === day.key} aria-current={day.key === today ? 'date' : undefined} aria-label={`${day.key} ${day.label}요일${loading || error ? '' : `, 예정 일정 ${count}개`}`} onClick={() => setSelectedScheduleDate(day.key)}>
                <span>{day.label}</span><b>{day.day}</b>
                {!loading && !error && <span className={styles.dayCount} aria-hidden="true">{count}</span>}
              </button>
            })}
          </div>
          <div className={styles.selectedDayHeading}><strong>{Number(selectedDate.slice(5, 7))}월 {Number(selectedDate.slice(8))}일 {selectedDate === today && <span className={styles.badge}>오늘</span>}</strong>{!loading && !error && <span className={styles.muted}>{selectedSchedules.length}개 일정</span>}</div>
          <div className={styles.scheduleCards} role="region" aria-label="선택한 날짜의 일정 목록" tabIndex={0} aria-live="polite">
            {loading ? <p className={styles.muted}>일정을 불러오는 중입니다.</p> : error ? <p className={styles.muted}>일정을 불러오지 못했습니다. 일정 탭에서 다시 확인해 주세요.</p> : selectedSchedules.length ? selectedSchedules.map((rule) => <Link className={styles.scheduleCard} to={`${href('schedules')}&ruleId=${rule.ruleId}`} key={rule.ruleId}>
              <span className={styles.scheduleTime}><Icon name="clock" size={14} />{rule.startTime?.slice(0, 5) || '09:00'}</span>
              <span className={styles.itemContent}><strong>{rule.title}</strong><span className={styles.muted}>{FREQUENCY_LABELS[rule.frequency]} 일정</span></span>
              <Icon name="chevronRight" size={16} className={styles.rowArrow} />
            </Link>) : <div className={styles.compactEmpty}><Icon name="calendar" size={22} /><span>이 날짜에 예정된 일정이 없습니다.</span></div>}
          </div>
        </>
      )}
    </Panel>
    <Panel title="업무" icon="checkSquare" href={canViewTasks ? href('tasks') : undefined} bodyClassName={!canViewTasks ? styles.fullHeightBody : styles.taskBody}>
      {!canViewTasks ? (
        <div className={styles.permissionRestricted}>
          <Icon name="lock" size={24} />
          <strong>업무 조회 권한이 없습니다</strong>
          <span>이 워크스페이스의 업무 목록을 보려면 업무 조회 권한이 필요합니다.</span>
        </div>
      ) : (
        <>
          <div className={styles.taskProgressHeading}><span>전체 업무 완료율</span><strong>{completionRate}<small>%</small></strong></div>
          <div className={styles.taskProgressBar} role="progressbar" aria-label="업무 완료율" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionRate}>
            <span className={styles.progressDone} style={{ width: `${tasks.length ? completedCount / tasks.length * 100 : 0}%` }} />
            <span className={styles.progressActive} style={{ width: `${tasks.length ? inProgressCount / tasks.length * 100 : 0}%` }} />
          </div>
          <div className={styles.progressLegend}><span><i className={styles.progressDone} />완료 <b>{completedCount}</b></span><span><i className={styles.progressActive} />진행 중 <b>{inProgressCount}</b></span><span><i />예정 <b>{todoCount}</b></span></div>
          <div className={styles.priorityHeading}><strong>먼저 확인할 업무</strong><span className={styles.muted}>기한 초과 · 오늘부터 6일 이내 마감</span></div>
          <div className={styles.taskList} role="region" aria-label="먼저 확인할 업무 목록" tabIndex={0}>
          {priorityTasks.length ? <div className={styles.priorityTasks}>{priorityTasks.map(({ item, days }) => {
            const canDetail = canViewWorkItemDetail(currentUserId, item, snapshot)
            const cardClasses = [styles.priorityTask, days < 0 ? styles.priorityOverdue : '', !canDetail ? styles.priorityTaskDisabled : ''].filter(Boolean).join(' ')
            const content = <>
              <span className={styles.taskIcon}><Icon name={days < 0 ? 'alertTriangle' : 'checkCircle'} size={18} /></span>
              <span className={styles.itemContent}><strong>{item.title}</strong><span className={styles.meta}><span className={styles.statusBadge}>{getWorkItemStatusLabel(item.status)}</span><span className={styles.person}><Icon name="user" size={15} /><span>{userName(item.ownerUserId)}</span></span></span></span>
              <span className={[styles.badge, days < 0 ? styles.overdue : styles.due].join(' ')}>{days < 0 ? `${-days}일 초과` : days === 0 ? 'D-Day' : `D-${days}`}</span>
              {canDetail && <Icon name="chevronRight" size={16} className={styles.rowArrow} />}
            </>
            return canDetail ? (
              <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={cardClasses}>
                {content}
              </Link>
            ) : (
              <div key={item.workItemId} className={cardClasses} title="다른 사용자의 업무 상세 내용을 조회할 권한이 없습니다.">
                {content}
              </div>
            )
          })}</div> : <div className={styles.compactEmpty}><Icon name="checkCircle" size={22} /><span>{!tasks.length ? '등록된 업무가 없습니다.' : !pending.length ? '모든 업무가 완료되었습니다.' : '기한이 지났거나 7일 미만 남은 업무가 없습니다.'}</span></div>}
          </div>
        </>
      )}
    </Panel>
    <Panel title="최근 활동" icon="lineChart" bodyClassName={!canViewHist ? styles.fullHeightBody : ''}>
      {!canViewHist ? (
        <div className={styles.permissionRestricted}>
          <Icon name="lock" size={24} />
          <strong>활동 이력 조회 권한이 없습니다</strong>
          <span>이 워크스페이스의 활동 로그를 보려면 활동 이력 조회 권한이 필요합니다.</span>
        </div>
      ) : activities.length ? activities.map((activity) => {
        const actorName = activity.actorName || userName(activity.actorUserId)
        const message = formatActivityMessage(activity, { actorName, resolveUserName, resolveWorkItemTitle: (id) => snapshot.workItems.find((item) => item.workItemId === id)?.title })
        const action = message.match(/([^\s.]+했습니다)\.$/)
        const actorEnd = message.startsWith(actorName) ? actorName.length : 0
        const actionStart = action?.index ?? message.length
        const content = <><span className={styles.activityAvatar}><UserAvatar name={actorName} userId={activity.actorUserId} size="medium" /></span><span className={styles.itemContent}><span className={styles.activityMessage}><strong>{message.slice(0, actorEnd)}</strong>{message.slice(actorEnd, actionStart)}{action && <strong className={styles.activityAction}>{action[1]}</strong>}{action ? '.' : ''}</span><small className={styles.muted}>{new Date(activity.createdAt).toLocaleString('ko-KR')}</small></span></>
        const rawLink = getActivityLink(activity)
        // 활동 링크가 업무 상세인 경우 권한 검사
        let activityLink = rawLink
        if (rawLink && rawLink.startsWith('/work-items/')) {
          const targetItemId = decodeURIComponent(rawLink.replace('/work-items/', ''))
          const targetItem = snapshot.workItems.find((w) => w.workItemId === targetItemId)
          if (targetItem && !canViewWorkItemDetail(currentUserId, targetItem, snapshot)) {
            activityLink = null
          }
        }
        return activityLink ? <Link className={styles.item} key={activity.id} to={activityLink}>{content}</Link> : <div className={styles.item} key={activity.id}>{content}</div>
      }) : <p className={styles.muted}>최근 활동이 없습니다.</p>}
    </Panel>
  </div>
}
