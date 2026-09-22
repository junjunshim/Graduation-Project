import type { ActivityRecord } from '../../workspace/model/types'
import { AUTHORITY_BITS, parseAuthorityBitSet } from '../../workspace/model/authorityDefinitions.js'
import {
  getNodeTypeLabel,
  getRecurringCategoryLabel,
  getWorkItemPriorityMeta,
  getWorkItemStatusLabel,
} from '../../workspace/model/labels.js'
import { withJosa } from './koreanParticle.js'

export type ActivityAuthorityDiff = { added: string[]; removed: string[] }

export type ActivityFormatOptions = {
  actorName?: string
  targetName?: string
  resolveUserName?: (userId: string) => string | undefined
  resolveWorkItemTitle?: (workItemId: string) => string | undefined
  resolveNodeTypeLabel?: (nodeType: string) => string
  resolveAuthorityDiff?: (oldValue: string | null, newValue: string | null) => ActivityAuthorityDiff
}

const ENTITY_NOUNS: Record<string, string> = {
  NODE: '조직',
  USER: '사용자',
  WORK_ITEM: '업무',
  RECURRING_RULE: '일정',
  ROLE: '역할',
  AUTHORITY: '권한',
  COMMENT: '댓글',
  FILE: '파일',
}

const FIELD_NAME_LABELS: Record<string, string> = {
  title: '제목',
  name: '이름',
  owner: '담당자',
  assignee: '담당자',
  node_type: '유형',
  workspace_location: '위치',
  category: '카테고리',
  status: '상태',
  progress: '진행률',
  parent: '상위 업무',
  role: '역할',
  authority: '권한',
  description: '설명',
  priority: '우선순위',
  start_date: '시작일',
  due_date: '마감일',
  frequency: '반복 주기',
  time: '시간',
  repeat_period: '반복 기간',
  holiday_policy: '공휴일 처리',
  auto_create: '자동 업무 생성',
  is_active: '활성 상태',
  checklist: '체크리스트',
}

const WEEKDAY_LABELS: Record<string, string> = {
  MO: '월',
  TU: '화',
  WE: '수',
  TH: '목',
  FR: '금',
  SA: '토',
  SU: '일',
}

const FREQUENCY_LABELS: Record<string, string> = {
  DAILY: '매일',
  WEEKLY: '매주',
  MONTHLY: '매월',
  YEARLY: '매년',
}

const FREQUENCY_UNITS: Record<string, string> = {
  DAILY: '일',
  WEEKLY: '주',
  MONTHLY: '개월',
  YEARLY: '년',
}

const SET_POS_LABELS: Record<string, string> = {
  '1': '첫째 주',
  '2': '둘째 주',
  '3': '셋째 주',
  '4': '넷째 주',
  '-1': '마지막 주',
}

const HOLIDAY_ACTION_LABELS: Record<string, string> = {
  SKIP: '건너뜀',
  NEXT_WORKDAY: '다음 평일',
  PREV_WORKDAY: '이전 평일',
}

type ValuePairOptions = { emptyIsUnknown?: boolean }

function text(value: string | null | undefined): string {
  return (value ?? '').trim()
}

function quoted(value: string): string {
  return `‘${value}’`
}

function limitList(items: string[], max = 4): string {
  if (items.length <= max) {
    return items.join(', ')
  }

  return `${items.slice(0, max).join(', ')} 외 ${items.length - max}개`
}

/** 이전·이후 값을 표시 문자열로 바꾼다. 한쪽이라도 알 수 없으면 null(값 없이 문장 생성) */
function tailPair(
  oldValue: string | null | undefined,
  newValue: string | null | undefined,
  format: (raw: string) => string,
  options: ValuePairOptions = {},
): string | null {
  if (oldValue === null || oldValue === undefined || newValue === null || newValue === undefined) {
    return null
  }

  const emptyIsUnknown = options.emptyIsUnknown !== false
  if (emptyIsUnknown && (text(oldValue) === '' || text(newValue) === '')) {
    return null
  }

  const oldText = format(oldValue)
  const newText = format(newValue)
  if (oldText === newText) {
    return null
  }

  return `${oldText} → ${newText}`
}

function changeSentence(actor: string, subject: string, fieldLabel: string, tail: string | null): string {
  const suffix = tail ? ` (${tail})` : ''
  return `${actor}님이 ${subject}의 ${withJosa(fieldLabel, '을/를')} 변경했습니다.${suffix}`
}

function statusLabel(raw: string): string {
  if (raw === 'todo' || raw === 'in-progress' || raw === 'done') {
    return getWorkItemStatusLabel(raw)
  }
  if (raw === 'in_progress') {
    return getWorkItemStatusLabel('in-progress')
  }

  return raw
}

function priorityLabel(raw: string): string {
  const level = Number(raw)
  if (!Number.isFinite(level) || level < 1 || level > 5) {
    return raw
  }

  return getWorkItemPriorityMeta(level).label
}

function subjectPhrase(entityType: string, targetName: string, noun: string): string {
  if (!targetName) {
    return `항목 ${noun}`
  }

  if (entityType === 'WORK_ITEM' || entityType === 'RECURRING_RULE') {
    return `${noun} ${quoted(targetName)}`
  }

  return `${quoted(targetName)} ${noun}`
}

function resolveActorName(activity: ActivityRecord, options: ActivityFormatOptions): string {
  const fromCache = activity.actorUserId ? text(options.resolveUserName?.(activity.actorUserId)) : ''
  return text(options.actorName) || text(activity.actorName) || fromCache || text(activity.actorUserId) || '사용자'
}

function resolveTargetName(activity: ActivityRecord, options: ActivityFormatOptions): string {
  return text(options.targetName) || text(activity.targetName)
}

/* ------------------------------------------------------------------ */
/* 업무(WORK_ITEM)                                                      */
/* ------------------------------------------------------------------ */

function workItemFieldTail(
  field: string,
  activity: ActivityRecord,
  options: ActivityFormatOptions,
): string | null {
  const oldValue = activity.oldValue ?? null
  const newValue = activity.newValue ?? null

  switch (field) {
    case 'description':
      return null
    case 'status':
      return tailPair(oldValue, newValue, (raw) => quoted(statusLabel(raw)))
    case 'progress':
      return tailPair(oldValue, newValue, (raw) => `${raw}%`)
    case 'parent':
      return tailPair(oldValue, newValue, (raw) =>
        raw === 'ROOT' ? '최상위' : quoted(text(options.resolveWorkItemTitle?.(raw)) || raw),
      )
    case 'priority':
      return tailPair(oldValue, newValue, (raw) => quoted(priorityLabel(raw)))
    case 'start_date':
    case 'due_date':
      return tailPair(oldValue, newValue, (raw) => quoted(raw || '없음'), { emptyIsUnknown: false })
    case 'title':
    case 'category':
    case 'owner':
      return tailPair(oldValue, newValue, (raw) => quoted(raw))
    default:
      return tailPair(oldValue, newValue, (raw) => quoted(raw))
  }
}

function formatWorkItemUpdate(
  actor: string,
  subject: string,
  activity: ActivityRecord,
  options: ActivityFormatOptions,
): string {
  const field = text(activity.fieldName).toLowerCase()
  if (!field) {
    return `${actor}님이 ${withJosa(subject, '을/를')} 수정했습니다.`
  }

  const label = FIELD_NAME_LABELS[field] ?? field
  return changeSentence(actor, subject, label, workItemFieldTail(field, activity, options))
}

/* ------------------------------------------------------------------ */
/* 일정(RECURRING_RULE) — 그룹 단위 로그                                 */
/* ------------------------------------------------------------------ */

function formatFrequencyValue(raw: string): string {
  const [frequencyRaw, intervalRaw, byDay, byMonthDay, bySetPos] = raw.split('|')
  const frequency = text(frequencyRaw).toUpperCase()
  const interval = Number(intervalRaw)
  const hasInterval = Number.isFinite(interval) && interval > 1

  let base = FREQUENCY_LABELS[frequency] ?? frequency
  if (hasInterval) {
    base = `${interval}${FREQUENCY_UNITS[frequency] ?? ''}마다`
  }

  if (frequency === 'WEEKLY') {
    const days = text(byDay)
      .split(',')
      .map((day) => WEEKDAY_LABELS[day.trim().toUpperCase()] ?? day.trim())
      .filter(Boolean)
      .join(',')
    return days ? `${base} ${days}` : base
  }

  if (frequency === 'MONTHLY') {
    const parts = [base]
    if (text(byMonthDay)) {
      parts.push(`${text(byMonthDay)}일`)
    }
    if (text(bySetPos)) {
      parts.push(SET_POS_LABELS[text(bySetPos)] ?? text(bySetPos))
    }
    return parts.join(' ')
  }

  return base
}

function formatScheduleTimeValue(raw: string): string {
  const [startRaw, durationRaw] = raw.split('|')
  const start = text(startRaw)
  const duration = text(durationRaw)
  const parts: string[] = []

  if (start) {
    parts.push(start.length > 5 ? start.slice(0, 5) : start)
  }
  if (duration) {
    parts.push(`${duration}분`)
  }

  return parts.join(' · ') || '없음'
}

function formatRepeatPeriodValue(raw: string): string {
  const [startRaw, endRaw, maxRaw] = raw.split('|')
  const start = text(startRaw) || '없음'
  const end = text(endRaw) || '없음'
  const max = text(maxRaw)
  return `${start} ~ ${end}${max ? ` · 최대 ${max}회` : ''}`
}

function formatHolidayPolicyValue(raw: string): string {
  const [excludeRaw, actionRaw] = raw.split('|')
  const excluded = text(excludeRaw).toUpperCase() === 'TRUE'
  const action = text(actionRaw).toUpperCase()
  const label = excluded ? '제외' : '포함'

  if (excluded && action) {
    return `${label} · ${HOLIDAY_ACTION_LABELS[action] ?? action}`
  }

  return label
}

function recurringFieldTail(field: string, activity: ActivityRecord): string | null {
  const oldValue = activity.oldValue ?? null
  const newValue = activity.newValue ?? null

  switch (field) {
    case 'description':
    case 'checklist':
      return null
    case 'assignee':
      return tailPair(oldValue, newValue, (raw) => (text(raw) ? quoted(text(raw)) : '미지정'), {
        emptyIsUnknown: false,
      })
    case 'title':
      return tailPair(oldValue, newValue, (raw) => quoted(text(raw)))
    case 'category':
      return tailPair(oldValue, newValue, (raw) => quoted(getRecurringCategoryLabel(text(raw))))
    case 'frequency':
      return tailPair(oldValue, newValue, (raw) => quoted(formatFrequencyValue(raw)), { emptyIsUnknown: false })
    case 'time':
      return tailPair(oldValue, newValue, (raw) => quoted(formatScheduleTimeValue(raw)), { emptyIsUnknown: false })
    case 'repeat_period':
      return tailPair(oldValue, newValue, (raw) => quoted(formatRepeatPeriodValue(raw)), {
        emptyIsUnknown: false,
      })
    case 'holiday_policy':
      return tailPair(oldValue, newValue, (raw) => quoted(formatHolidayPolicyValue(raw)), {
        emptyIsUnknown: false,
      })
    case 'auto_create':
      return tailPair(oldValue, newValue, (raw) => (text(raw).toUpperCase() === 'TRUE' ? '사용' : '사용 안 함'), {
        emptyIsUnknown: false,
      })
    case 'is_active':
      return tailPair(oldValue, newValue, (raw) => (text(raw).toUpperCase() === 'TRUE' ? '활성' : '비활성'), {
        emptyIsUnknown: false,
      })
    default:
      return tailPair(oldValue, newValue, (raw) => quoted(text(raw)))
  }
}

function formatRecurringUpdate(actor: string, subject: string, activity: ActivityRecord): string {
  const field = text(activity.fieldName).toLowerCase()
  if (!field) {
    return `${actor}님이 ${withJosa(subject, '을/를')} 수정했습니다.`
  }

  const label = FIELD_NAME_LABELS[field] ?? field
  return changeSentence(actor, subject, label, recurringFieldTail(field, activity))
}

/* ------------------------------------------------------------------ */
/* 댓글 · 파일 · 역할 · 권한 · 사용자                                    */
/* ------------------------------------------------------------------ */

function formatCommentMessage(actor: string, activity: ActivityRecord, options: ActivityFormatOptions): string {
  const action = text(activity.actionType).toLowerCase()
  const raw = resolveTargetName(activity, options)
  const workItemCode = /^Comment on\s+(.+)$/i.exec(raw)?.[1]?.trim() ?? ''
  const title = workItemCode ? text(options.resolveWorkItemTitle?.(workItemCode)) : ''
  const place = title ? `업무 ${quoted(title)}에 ` : workItemCode ? `업무[${workItemCode}]에 ` : ''

  if (action === 'deleted') {
    return `${actor}님이 ${place}댓글을 삭제했습니다.`
  }
  if (action === 'updated') {
    return `${actor}님이 ${place}댓글을 수정했습니다.`
  }

  return `${actor}님이 ${place}댓글을 등록했습니다.`
}

function formatFileMessage(actor: string, targetName: string, action: string): string {
  const fileName = targetName.replace(/^(uploaded|deleted|restored)\s+(recurring\s+)?file:\s*/i, '').trim()
  const verb = action === 'deleted' ? '삭제' : action === 'restored' ? '복구' : '업로드'

  if (!fileName) {
    return `${actor}님이 파일을 ${verb}했습니다.`
  }

  return `${actor}님이 파일 ${withJosa(quoted(fileName), '을/를')} ${verb}했습니다.`
}

function formatUserMessage(actor: string, targetName: string, action: string, activity: ActivityRecord): string {
  const person = targetName ? `${quoted(targetName)}님` : actor
  const subject = withJosa(person, '이/가')

  if (action === 'deleted') {
    return `${subject} 계정을 삭제했습니다.`
  }
  if (action === 'updated') {
    const tail = tailPair(activity.oldValue ?? null, activity.newValue ?? null, (raw) => quoted(text(raw)))
    return `${subject} 이름을 변경했습니다.${tail ? ` (${tail})` : ''}`
  }

  return `${subject} 계정 정보에 대해 ‘${text(activity.actionType)}’ 활동을 수행했습니다.`
}

function formatRoleMessage(
  actor: string,
  targetName: string,
  action: string,
  activity: ActivityRecord,
  options: ActivityFormatOptions,
): string {
  // 레거시 로그는 대상 이름 자리에 사용자 ID가 들어 있을 수 있다.
  const personName = targetName ? text(options.resolveUserName?.(targetName)) || targetName : ''
  const person = personName ? `${quoted(personName)}님` : '대상 사용자'
  // 회수(deleted) 로그는 회수된 역할명이 oldValue 에 담긴다. (기존 로그는 newValue 를 사용)
  const roleName = action === 'deleted' ? text(activity.oldValue ?? activity.newValue) : text(activity.newValue)

  if (action === 'inserted' || action === 'created') {
    return roleName
      ? `${actor}님이 ${person}에게 ${quoted(roleName)} 역할을 부여했습니다.`
      : `${actor}님이 ${person}에게 역할을 부여했습니다.`
  }
  if (action === 'deleted') {
    return roleName
      ? `${actor}님이 ${person}의 ${quoted(roleName)} 역할을 회수했습니다.`
      : `${actor}님이 ${person}의 역할을 회수했습니다.`
  }
  if (action === 'updated') {
    const tail = tailPair(activity.oldValue ?? null, activity.newValue ?? null, (raw) => quoted(text(raw)))
    return `${actor}님이 ${person}의 역할을 변경했습니다.${tail ? ` (${tail})` : ''}`
  }

  return `${actor}님이 ${person}의 역할에 대해 ‘${text(activity.actionType)}’ 활동을 수행했습니다.`
}

function defaultAuthorityDiff(oldValue: string | null, newValue: string | null): ActivityAuthorityDiff {
  const oldSet = parseAuthorityBitSet(text(oldValue))
  const newSet = parseAuthorityBitSet(text(newValue))
  const label = (bit: number) => AUTHORITY_BITS.find((info) => info.bit === bit)?.label ?? `권한 ${bit}`

  return {
    added: [...newSet].filter((bit) => bit !== 23 && !oldSet.has(bit)).sort((a, b) => a - b).map(label),
    removed: [...oldSet].filter((bit) => bit !== 23 && !newSet.has(bit)).sort((a, b) => a - b).map(label),
  }
}

function formatAuthorityDiff(diff: ActivityAuthorityDiff): string {
  const parts: string[] = []
  if (diff.added.length > 0) {
    parts.push(`${limitList(diff.added)} 추가`)
  }
  if (diff.removed.length > 0) {
    parts.push(`${limitList(diff.removed)} 제거`)
  }

  return parts.join(' / ')
}

function formatAuthorityMessage(
  actor: string,
  targetName: string,
  action: string,
  activity: ActivityRecord,
  options: ActivityFormatOptions,
): string {
  const role = targetName ? `${quoted(targetName)} 역할` : '대상 역할'

  if (action === 'inserted' || action === 'created') {
    return `${actor}님이 ${role}에 권한을 설정했습니다.`
  }
  if (action === 'deleted') {
    // 역할 정의 삭제(AUTHORITY + field 'role')는 역할 자체가 사라진 것이므로 삭제로 표현한다.
    if (text(activity.fieldName).toLowerCase() === 'role') {
      const subject = targetName ? `역할 ${quoted(targetName)}` : '역할'
      return `${actor}님이 ${withJosa(subject, '을/를')} 삭제했습니다.`
    }
    return `${actor}님이 ${role}의 권한을 회수했습니다.`
  }
  if (action === 'updated') {
    if (text(activity.fieldName).toLowerCase() === 'role') {
      const tail = tailPair(activity.oldValue ?? null, activity.newValue ?? null, (raw) => quoted(text(raw)))
      const renamed = targetName ? `역할 ${quoted(targetName)}` : '역할'
      return `${actor}님이 ${renamed}의 이름을 변경했습니다.${tail ? ` (${tail})` : ''}`
    }

    const diff = (options.resolveAuthorityDiff ?? defaultAuthorityDiff)(
      activity.oldValue ?? null,
      activity.newValue ?? null,
    )
    const tail = formatAuthorityDiff(diff)
    return `${actor}님이 ${role}의 권한을 변경했습니다.${tail ? ` (${tail})` : ''}`
  }

  return `${actor}님이 ${role}의 권한에 대해 ‘${text(activity.actionType)}’ 활동을 수행했습니다.`
}

/* ------------------------------------------------------------------ */
/* 멘션                                                                 */
/* ------------------------------------------------------------------ */

/** 댓글 멘션 알림 문구. 업무 제목을 알 수 없으면 업무 코드 → 댓글 순으로 표기한다. */
export function formatMentionMessage(workItemId: string, options: ActivityFormatOptions = {}): string {
  const actor = text(options.actorName) || '사용자'
  const id = text(workItemId)
  const title = id ? text(options.resolveWorkItemTitle?.(id)) : ''
  const place = title ? `업무 ${quoted(title)}에서` : id ? `업무[${id}]에서` : '댓글에서'

  return `${actor}님이 ${place} 회원님을 멘션했습니다.`
}

/* ------------------------------------------------------------------ */
/* 진입점                                                               */
/* ------------------------------------------------------------------ */

export function formatActivityMessage(activity: ActivityRecord, options: ActivityFormatOptions = {}): string {
  const action = text(activity.actionType).toLowerCase()
  const entityType = text(activity.entityType).toUpperCase()
  const actor = resolveActorName(activity, options)
  const targetName = resolveTargetName(activity, options)
  const noun = ENTITY_NOUNS[entityType] ?? entityType

  if (entityType === 'COMMENT') {
    return formatCommentMessage(actor, activity, options)
  }
  if (entityType === 'FILE') {
    return formatFileMessage(actor, targetName, action)
  }
  if (entityType === 'ROLE') {
    return formatRoleMessage(actor, targetName, action, activity, options)
  }
  if (entityType === 'AUTHORITY') {
    return formatAuthorityMessage(actor, targetName, action, activity, options)
  }
  if (entityType === 'USER') {
    return formatUserMessage(actor, targetName, action, activity)
  }

  const subject = subjectPhrase(entityType, targetName, noun)

  switch (action) {
    case 'inserted':
    case 'created':
      return `${actor}님이 ${withJosa(subject, '을/를')} 생성했습니다.`
    case 'deleted':
      return `${actor}님이 ${withJosa(subject, '을/를')} 삭제했습니다.`
    case 'restored':
      return `${actor}님이 ${withJosa(subject, '을/를')} 복구했습니다.`
    case 'updated': {
      if (entityType === 'WORK_ITEM') {
        return formatWorkItemUpdate(actor, subject, activity, options)
      }
      if (entityType === 'RECURRING_RULE') {
        return formatRecurringUpdate(actor, subject, activity)
      }

      const field = text(activity.fieldName).toLowerCase()
      if (!field) {
        return `${actor}님이 ${withJosa(subject, '을/를')} 수정했습니다.`
      }

      const label = FIELD_NAME_LABELS[field] ?? field
      const tail =
        field === 'name' || field === 'node_type'
          ? tailPair(activity.oldValue ?? null, activity.newValue ?? null, (raw) =>
              field === 'node_type'
                ? quoted(
                    text(options.resolveNodeTypeLabel?.(raw)) ||
                      getNodeTypeLabel(raw as Parameters<typeof getNodeTypeLabel>[0]),
                  )
                : quoted(text(raw)),
            )
          : tailPair(activity.oldValue ?? null, activity.newValue ?? null, (raw) => quoted(text(raw)))

      return changeSentence(actor, subject, label, tail)
    }
    default:
      return `${actor}님이 ${subject} ${noun}에 대해 ‘${text(activity.actionType)}’ 활동을 수행했습니다.`
  }
}
