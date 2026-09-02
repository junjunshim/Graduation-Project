import type { ActivityRecord } from '../../workspace/model/types'

const ENTITY_TYPE_LABELS: Record<string, string> = {
  NODE: '조직 노드',
  WORK_ITEM: '업무',
  ROLE: '역할',
  AUTHORITY: '권한',
  COMMENT: '댓글',
  FILE: '파일',
}

const FIELD_NAME_LABELS: Record<string, string> = {
  title: '제목',
  name: '이름',
  description: '설명',
  status: '상태',
  priority: '우선순위',
  weight: '가중치',
  progress: '진행률',
  hidden: '숨김 여부',
  start_date: '시작일',
  due_date: '마감일',
  parent_id: '상위 업무',
  parent_node_id: '상위 노드',
}

const STATUS_VALUE_LABELS: Record<string, string> = {
  todo: '할 일',
  'in-progress': '진행 중',
  in_progress: '진행 중',
  done: '완료',
}

export function formatActivityMessage(activity: ActivityRecord): string {
  const actor = activity.actorName || activity.actorUserId || '사용자'
  const entityLabel = ENTITY_TYPE_LABELS[activity.entityType.toUpperCase()] ?? activity.entityType
  const target = activity.targetName ? `‘${activity.targetName}’` : '항목'

  switch (activity.actionType.toLowerCase()) {
    case 'inserted':
    case 'created':
      return `${actor}님이 ${target} ${entityLabel}을(를) 생성했습니다.`

    case 'deleted':
      return `${actor}님이 ${target} ${entityLabel}을(를) 삭제했습니다.`

    case 'restored':
      return `${actor}님이 ${target} ${entityLabel}을(를) 복구했습니다.`

    case 'updated': {
      if (activity.fieldName) {
        const fieldLabel = FIELD_NAME_LABELS[activity.fieldName.toLowerCase()] ?? activity.fieldName

        if (activity.fieldName.toLowerCase() === 'status') {
          const oldStatus = activity.oldValue ? STATUS_VALUE_LABELS[activity.oldValue] ?? activity.oldValue : null
          const newStatus = activity.newValue ? STATUS_VALUE_LABELS[activity.newValue] ?? activity.newValue : null
          if (oldStatus && newStatus) {
            return `${actor}님이 ${target} 상태를 ‘${oldStatus}’에서 ‘${newStatus}’(으)로 변경했습니다.`
          }
          if (newStatus) {
            return `${actor}님이 ${target} 상태를 ‘${newStatus}’(으)로 변경했습니다.`
          }
        }

        if (activity.fieldName.toLowerCase() === 'progress') {
          return `${actor}님이 ${target} 진행률을 ${activity.newValue}%로 업데이트했습니다.`
        }

        if (activity.oldValue && activity.newValue) {
          return `${actor}님이 ${target}의 ${fieldLabel}을(를) ‘${activity.oldValue}’에서 ‘${activity.newValue}’(으)로 수정했습니다.`
        }

        return `${actor}님이 ${target}의 ${fieldLabel}을(를) 수정했습니다.`
      }

      return `${actor}님이 ${target} ${entityLabel}을(를) 수정했습니다.`
    }

    default:
      return `${actor}님이 ${target} ${entityLabel}에 대해 ‘${activity.actionType}’ 활동을 수행했습니다.`
  }
}
