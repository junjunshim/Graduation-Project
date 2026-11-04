import assert from 'node:assert/strict'
import test from 'node:test'
import { formatNotificationMessage } from '../renderer/features/notification/model/notificationMessage.js'
import type { LiveNotificationPayload } from '../renderer/features/workspace/data/workspaceCacheEvents.js'

const base = {
  actor_name: '김철수',
  created_at: '2026-10-24T00:00:00Z',
  can_view_detail: true,
} satisfies LiveNotificationPayload

test('GitHub 저장소·브랜치·push 알람 문구를 만든다', () => {
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'GITHUB',
      entity_type: 'GITHUB_REPOSITORY',
      action: 'deleted',
      repo_full_name: 'acme/axis',
    }),
    '김철수님이 저장소 ‘acme/axis’ 연결을 해제했습니다.',
  )
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'GITHUB',
      entity_type: 'GITHUB_BRANCH',
      action: 'inserted',
      repo_full_name: 'acme/axis',
      branch: 'feature/login',
    }),
    '김철수님이 저장소 ‘acme/axis’에서 브랜치 ‘feature/login’를 생성했습니다.',
  )
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'GITHUB',
      entity_type: 'GITHUB_PUSH',
      action: 'pushed',
      repo_full_name: 'acme/axis',
      branch: 'feature/login',
      pushed_commit_count: 3,
    }),
    '김철수님이 저장소 ‘acme/axis’의 ‘feature/login’ 브랜치를 원격에 push했습니다. (커밋 3개)',
  )
})

test('GitHub 커밋 문구는 짧은 SHA와 80자 미리보기를 쓴다', () => {
  const message = '로그인 API 구현 '.repeat(10).trim()
  const formatted = formatNotificationMessage({
    ...base,
    sub_type: 'GITHUB',
    entity_type: 'GITHUB_COMMIT',
    action: 'inserted',
    repo_full_name: 'acme/axis',
    branch: 'feature/login',
    commit_sha: 'a1b2c3d4e5',
    commit_message: message,
  })

  assert.match(formatted, /커밋 ‘.+…’를 생성했습니다\. \(a1b2c3d\)$/)
})

test('채널·DM·스레드·파일-only 채팅 문구를 만든다', () => {
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'CHAT_MESSAGE',
      channel_type: 'WORKSPACE',
      channel_name: '일반',
      content: '  회의는\n  3시에 시작합니다. ',
    }),
    '김철수님이 #일반 채널에 메시지를 보냈습니다: ‘회의는 3시에 시작합니다.’',
  )
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'CHAT_MESSAGE',
      channel_type: 'WORKSPACE',
      channel_name: '일반',
      content: '',
      attachment_count: 1,
      attachment_names: ['보고서.pdf'],
    }),
    '김철수님이 #일반 채널에 파일 ‘보고서.pdf’를 보냈습니다.',
  )
  assert.equal(
    formatNotificationMessage({
      ...base,
      sub_type: 'CHAT_MESSAGE',
      channel_type: 'DM',
      content: '확인했습니다.',
      parent_message_id: 7,
    }),
    '김철수님이 다이렉트 메시지의 스레드에 답글을 남겼습니다: ‘확인했습니다.’',
  )
})
