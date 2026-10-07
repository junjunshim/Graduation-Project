import assert from 'node:assert/strict'
import test from 'node:test'
import type { GithubCommit } from '../renderer/features/workspace/data/githubService.js'
import { layoutGitGraph } from '../renderer/features/workspace/model/gitGraph.js'

function commit(sha: string, parents: string[]): GithubCommit {
  return {
    sha,
    parents,
    subject: `${sha} 커밋`,
    author_name: '테스터',
    author_email: 'tester@example.com',
    authored_at: '2026-10-08T10:00:00+09:00',
    refs: [],
  }
}

test('일자 이력은 한 레인에 쌓이고 마지막 행에서 비워진다', () => {
  const layout = layoutGitGraph([commit('c', ['b']), commit('b', ['a']), commit('a', [])])

  assert.deepEqual(layout.nodes.map((node) => node.lane), [0, 0, 0])
  assert.equal(layout.laneCount, 1)
  assert.deepEqual(layout.laneSpans, [[0], [0], []])
  assert.deepEqual(layout.converged, [[], [], []])
  assert.deepEqual(layout.edges, [
    { from: { lane: 0, row: 0 }, to: { lane: 0, row: 1 } },
    { from: { lane: 0, row: 1 }, to: { lane: 0, row: 2 } },
  ])
})

test('머지는 둘째 부모를 오른쪽 레인으로 보내고, 다시 만나면 그 레인을 접는다', () => {
  // m ─┬─ a1 ── base
  //    └─ b1 ────┘
  const layout = layoutGitGraph([
    commit('m', ['a1', 'b1']),
    commit('a1', ['base']),
    commit('b1', ['base']),
    commit('base', []),
  ])

  assert.deepEqual(layout.nodes.map((node) => node.lane), [0, 0, 1, 0])
  assert.equal(layout.laneCount, 2)
  assert.deepEqual(layout.laneSpans[0], [0, 1])
  // base 는 두 레인이 함께 기다리던 커밋이라 1번 레인이 여기서 합쳐지고 아래로는 줄이 남지 않는다.
  assert.deepEqual(layout.converged[3], [1])
  assert.deepEqual(layout.laneSpans[3], [])
  assert.deepEqual(layout.edges, [
    { from: { lane: 0, row: 0 }, to: { lane: 0, row: 1 } },
    { from: { lane: 0, row: 0 }, to: { lane: 1, row: 2 } },
    { from: { lane: 0, row: 1 }, to: { lane: 0, row: 3 } },
    { from: { lane: 1, row: 2 }, to: { lane: 0, row: 3 } },
  ])
})

test('만나지 않는 줄기는 레인을 새로 연다', () => {
  const layout = layoutGitGraph([
    commit('main2', ['main1']),
    commit('side1', ['side0']),
    commit('main1', []),
    commit('side0', []),
  ])

  assert.deepEqual(layout.nodes.map((node) => node.lane), [0, 1, 0, 1])
  assert.equal(layout.laneCount, 2)
  assert.deepEqual(layout.laneSpans[1], [0, 1])
  assert.deepEqual(layout.laneSpans[2], [1])
  assert.deepEqual(layout.laneSpans[3], [])
  assert.deepEqual(layout.edges, [
    { from: { lane: 0, row: 0 }, to: { lane: 0, row: 2 } },
    { from: { lane: 1, row: 1 }, to: { lane: 1, row: 3 } },
  ])
})

test('limit 밖으로 잘린 부모는 선을 그리지 않는다', () => {
  const layout = layoutGitGraph([commit('c', ['b'])])

  assert.deepEqual(layout.edges, [])
  // 아래에 더 있을 수 있다는 표시로 레인은 열린 채 남는다.
  assert.deepEqual(layout.laneSpans[0], [0])
})

test('빈 목록은 레인 없이 돌아온다', () => {
  const layout = layoutGitGraph([])

  assert.deepEqual(layout.nodes, [])
  assert.deepEqual(layout.edges, [])
  assert.equal(layout.laneCount, 0)
})