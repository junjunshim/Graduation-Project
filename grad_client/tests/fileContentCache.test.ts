import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FILE_CONTENT_MEMORY_MAX_ITEMS,
  clearCachedFileContents,
  deleteCachedFileContent,
  getCachedFileContent,
  setCachedFileContent,
} from '../renderer/features/workspace/data/fileContentCache.js'

function createItem(fileId: number) {
  return {
    fileId,
    fileName: `file-${fileId}.txt`,
    content: `content-${fileId}`,
    lastModified: 'Wed, 21 Oct 2026 00:00:00 GMT',
    cachedAt: 1_000 + fileId,
  }
}

test('file content cache stores and deletes entries', async () => {
  await clearCachedFileContents()
  const item = createItem(1)

  await setCachedFileContent(item)
  assert.deepEqual(await getCachedFileContent(1), item)

  await deleteCachedFileContent(1)
  assert.equal(await getCachedFileContent(1), null)
})

test('file content memory cache evicts the least recently used entry', async () => {
  await clearCachedFileContents()

  for (let fileId = 1; fileId <= FILE_CONTENT_MEMORY_MAX_ITEMS; fileId += 1) {
    await setCachedFileContent(createItem(fileId))
  }

  assert.notEqual(await getCachedFileContent(1), null)
  await setCachedFileContent(createItem(FILE_CONTENT_MEMORY_MAX_ITEMS + 1))

  assert.notEqual(await getCachedFileContent(1), null)
  assert.equal(await getCachedFileContent(2), null)
  assert.equal(
    (await getCachedFileContent(FILE_CONTENT_MEMORY_MAX_ITEMS + 1))?.fileId,
    FILE_CONTENT_MEMORY_MAX_ITEMS + 1,
  )
})
