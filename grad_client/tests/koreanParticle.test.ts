import assert from 'node:assert/strict'
import test from 'node:test'
import { hasBatchim, josa, withJosa } from '../renderer/features/dashboard/model/koreanParticle.js'
import { formatActivityMessage, formatMentionMessage } from '../renderer/features/dashboard/model/activityFormatter.js'
import type { ActivityRecord } from '../renderer/features/workspace/model/types.js'

test('받침 유무는 마지막 한글 음절로 판별한다', () => {
  assert.equal(hasBatchim('업무'), false)
  assert.equal(hasBatchim('구현'), true)
  assert.equal(hasBatchim('‘보고서.pdf’'), false)
  assert.equal(hasBatchim('‘로그인 기능 구현’'), true)
  assert.equal(hasBatchim('40%'), false)
})

test('조사는 받침에 맞게 고른다', () => {
  assert.equal(josa('업무', '을/를'), '를')
  assert.equal(josa('일정', '을/를'), '을')
  assert.equal(josa('‘이영희’님', '이/가'), '이')
  assert.equal(josa('김철수', '이/가'), '가')
  assert.equal(josa('최상위', '으로/로'), '로')
  assert.equal(josa('서울', '으로/로'), '로')
  assert.equal(josa('부산', '으로/로'), '으로')
  assert.equal(withJosa('업무', '을/를'), '업무를')
})

const workItemActivity: ActivityRecord = {
  id: 1, nodeId: 1, actorUserId: 'user-1', actorName: '김철수',
  entityType: 'WORK_ITEM', entityId: 'WI-1', targetName: '로그인 기능 구현',
  actionType: 'updated', createdAt: '2026-09-19T00:00:00Z',
}

test('업무 변경 문구는 확정 문구를 따른다', () => {
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'due_date', oldValue: '2026-09-30', newValue: '2026-10-15' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 마감일을 변경했습니다. (‘2026-09-30’ → ‘2026-10-15’)',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'start_date', oldValue: '없음', newValue: '2026-09-10' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 시작일을 변경했습니다. (‘없음’ → ‘2026-09-10’)',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'priority', oldValue: '3', newValue: '2' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 우선순위를 변경했습니다. (‘보통’ → ‘높음’)',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'description', oldValue: null, newValue: null }),
    '김철수님이 업무 ‘로그인 기능 구현’의 설명을 변경했습니다.',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'status', oldValue: 'todo', newValue: 'in-progress' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 상태를 변경했습니다. (‘예정’ → ‘진행 중’)',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'progress', oldValue: '40', newValue: '100' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 진행률을 변경했습니다. (40% → 100%)',
  )
  assert.equal(
    formatActivityMessage({ ...workItemActivity, fieldName: 'owner', oldValue: '이영희', newValue: '박민수' }),
    '김철수님이 업무 ‘로그인 기능 구현’의 담당자를 변경했습니다. (‘이영희’ → ‘박민수’)',
  )
})

const scheduleActivity: ActivityRecord = {
  ...workItemActivity,
  entityType: 'RECURRING_RULE',
  entityId: '17',
  targetName: '주간 회의',
}

test('일정 그룹 변경 문구는 확정 문구를 따른다', () => {
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, fieldName: 'frequency', oldValue: 'WEEKLY|1|MO,WE||', newValue: 'WEEKLY|2|FR||' }),
    '김철수님이 일정 ‘주간 회의’의 반복 주기를 변경했습니다. (‘매주 월,수’ → ‘2주마다 금’)',
  )
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, fieldName: 'holiday_policy', oldValue: 'TRUE|NEXT_WORKDAY', newValue: 'FALSE|SKIP' }),
    '김철수님이 일정 ‘주간 회의’의 공휴일 처리를 변경했습니다. (‘제외 · 다음 평일’ → ‘포함’)',
  )
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, fieldName: 'time', oldValue: '10:00|60', newValue: '14:00|30' }),
    '김철수님이 일정 ‘주간 회의’의 시간을 변경했습니다. (‘10:00 · 60분’ → ‘14:00 · 30분’)',
  )
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, fieldName: 'repeat_period', oldValue: '2026-09-01||', newValue: '2026-09-01|2026-12-31|' }),
    '김철수님이 일정 ‘주간 회의’의 반복 기간을 변경했습니다. (‘2026-09-01 ~ 없음’ → ‘2026-09-01 ~ 2026-12-31’)',
  )
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, fieldName: 'checklist', oldValue: null, newValue: null }),
    '김철수님이 일정 ‘주간 회의’의 체크리스트를 변경했습니다.',
  )
  assert.equal(
    formatActivityMessage({ ...scheduleActivity, actionType: 'updated' }),
    '김철수님이 일정 ‘주간 회의’를 수정했습니다.',
  )
})

test('멘션 문구는 업무 제목 → 업무 코드 → 댓글 순으로 폴백한다', () => {
  assert.equal(
    formatMentionMessage('WI-7', {
      actorName: '김철수',
      resolveWorkItemTitle: (id) => (id === 'WI-7' ? '로그인 기능 구현' : undefined),
    }),
    '김철수님이 업무 ‘로그인 기능 구현’에서 회원님을 멘션했습니다.',
  )
  assert.equal(
    formatMentionMessage('WI-7', { actorName: '김철수' }),
    '김철수님이 업무[WI-7]에서 회원님을 멘션했습니다.',
  )
  assert.equal(
    formatMentionMessage('', { actorName: '김철수' }),
    '김철수님이 댓글에서 회원님을 멘션했습니다.',
  )
})

test('파일·댓글 문구는 파일명과 업무 제목만 사용한다', () => {
  assert.equal(
    formatActivityMessage({ ...workItemActivity, entityType: 'FILE', actionType: 'inserted', targetName: 'Uploaded file: 보고서.pdf' }),
    '김철수님이 파일 ‘보고서.pdf’를 업로드했습니다.',
  )
  assert.equal(
    formatActivityMessage(
      { ...workItemActivity, entityType: 'COMMENT', actionType: 'inserted', targetName: 'Comment on WI-7' },
      { resolveWorkItemTitle: (id) => (id === 'WI-7' ? '로그인 기능 구현' : undefined) },
    ),
    '김철수님이 업무 ‘로그인 기능 구현’에 댓글을 등록했습니다.',
  )
})