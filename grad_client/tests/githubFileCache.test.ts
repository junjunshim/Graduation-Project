import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchRepositoryFile } from '../renderer/features/workspace/data/githubService.js'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 서버 응답을 고정하고 요청 URL 을 모아 둔다. */
async function withStubbedFetch(
  body: unknown,
  run: (requested: string[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const requested: string[] = []

  globalThis.fetch = async (input) => {
    requested.push(String(input))
    return jsonResponse(body)
  }

  try {
    await run(requested)
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('파일 조회는 캐시 시각을 since 로 보내고, 안 바뀌었으면 캐시 사용을 알린다', async () => {
  await withStubbedFetch(
    {
      status: 'success',
      data: [
        {
          repo_id: 3,
          branch: 'main',
          path: 'src/a.ts',
          changed: false,
          modified_at: '2026-10-08T05:00:00+00:00',
        },
      ],
    },
    async (requested) => {
      const result = await fetchRepositoryFile({
        repoId: 3,
        branch: 'main',
        path: 'src/a.ts',
        since: '2026-10-08T05:00:00+00:00',
      })

      assert.equal(result.changed, false)
      assert.match(requested[0], /[?&]since=/)
    },
  )
})

test('내용이 실려 오면 파일과 검증 시각을 그대로 전달한다', async () => {
  await withStubbedFetch(
    {
      status: 'success',
      data: [
        {
          repo_id: 3,
          branch: 'main',
          path: 'src/a.ts',
          size: 5,
          encoding: 'utf-8',
          read_only: false,
          content: 'hello',
          changed: true,
          modified_at: '2026-10-08T06:00:00+00:00',
        },
      ],
    },
    async () => {
      const result = await fetchRepositoryFile({ repoId: 3, branch: 'main', path: 'src/a.ts' })

      assert.equal(result.changed, true)
      assert.equal(result.changed ? result.file.content : null, 'hello')
      assert.equal(result.changed ? result.file.modified_at : null, '2026-10-08T06:00:00+00:00')
    },
  )
})

test('단건 결과를 배열이 아닌 객체로 돌려주면 규격 위반으로 실패한다', async () => {
  // 서버가 data 를 객체로 돌려주던 회귀를 잡는다(성공 규격은 항상 {status, data[], message}).
  await withStubbedFetch(
    {
      status: 'success',
      data: { repo_id: 3, branch: 'main', path: 'src/a.ts', content: 'hello' },
    },
    async () => {
      await assert.rejects(
        () => fetchRepositoryFile({ repoId: 3, branch: 'main', path: 'src/a.ts' }),
        /data가 배열 형식이 아닙니다/,
      )
    },
  )
})