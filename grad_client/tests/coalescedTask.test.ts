import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoalescedTask } from '../renderer/features/workspace/data/server/coalescedTask.js'

test('짧은 간격의 연속 요청을 하나의 실행으로 합친다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runCount = 0
  const task = createCoalescedTask(
    () => {
      runCount += 1
    },
    { delayMs: 50 },
  )

  task.schedule()
  task.schedule()
  task.schedule()

  t.mock.timers.tick(49)
  assert.equal(runCount, 0)

  t.mock.timers.tick(1)
  assert.equal(runCount, 1)
  task.cancel()
})

test('실행 중 들어온 요청은 완료 후 한 번만 다시 실행한다', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runCount = 0
  const firstRun: { resolve: () => void } = { resolve: () => undefined }
  const task = createCoalescedTask(
    () => {
      runCount += 1
      if (runCount > 1) return

      return new Promise<void>((resolve) => {
        firstRun.resolve = resolve
      })
    },
    { delayMs: 50 },
  )

  task.schedule()
  t.mock.timers.tick(50)
  assert.equal(runCount, 1)

  task.schedule()
  task.schedule()
  t.mock.timers.tick(50)
  assert.equal(runCount, 1)

  firstRun.resolve()
  await Promise.resolve()

  t.mock.timers.tick(50)
  assert.equal(runCount, 2)
  task.cancel()
})

test('취소하면 예약된 실행을 시작하지 않는다', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let runCount = 0
  const task = createCoalescedTask(
    () => {
      runCount += 1
    },
    { delayMs: 50 },
  )

  task.schedule()
  task.cancel()
  t.mock.timers.tick(50)
  assert.equal(runCount, 0)
})
