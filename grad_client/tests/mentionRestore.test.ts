import assert from 'node:assert/strict'
import test from 'node:test'
import {
  mentionNotificationId,
  selectRestorableMentions,
} from '../renderer/features/notification/data/mentionRestore.js'
import type { MentionRecord } from '../renderer/features/workspace/model/types.js'

function mention(overrides: Partial<MentionRecord> & { id: number }): MentionRecord {
  return {
    commentId: 1,
    workItemId: 'WI-100',
    message: '댓글에서 회원님을 멘션했습니다.',
    isRead: false,
    createdAt: '2026-09-19T00:00:00Z',
    ...overrides,
  }
}

test('앱이 꺼진 동안 쌓인 알림은 읽지 않은 멘션만 최신순으로 복원한다', () => {
  const restored = selectRestorableMentions([
    mention({ id: 1, createdAt: '2026-09-17T00:00:00Z' }),
    mention({ id: 2, createdAt: '2026-09-19T00:00:00Z' }),
    mention({ id: 3, createdAt: '2026-09-18T00:00:00Z', isRead: true }),
    mention({ id: 4, createdAt: '2026-09-18T03:00:00Z', workItemId: '' }),
  ])

  assert.deepEqual(restored.map((item) => item.id), [2, 1])
})

test('벨에서 전체 삭제한 멘션은 다시 복원하지 않는다', () => {
  const restored = selectRestorableMentions(
    [mention({ id: 11 }), mention({ id: 12, createdAt: '2026-09-19T01:00:00Z' })],
    new Set([11]),
  )

  assert.deepEqual(restored.map((item) => item.id), [12])
  assert.deepEqual(selectRestorableMentions([mention({ id: 11 })], new Set([11])), [])
})

test('라이브 멘션 알림과 복원된 멘션은 같은 ID 로 합쳐진다', () => {
  assert.equal(mentionNotificationId(42), 'mention-42')
})
