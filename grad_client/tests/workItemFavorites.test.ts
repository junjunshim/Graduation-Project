import assert from 'node:assert/strict'
import test from 'node:test'
import { getFavoriteWorkItemIds, toggleFavoriteWorkItem } from '../renderer/features/workspace/data/workItemFavorites.js'

test('work item favorites persist by user and notify all views on add and remove', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const storage = new Map<string, string>()
  const events: string[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
    dispatchEvent: (event: Event) => { events.push(event.type); return true },
  } })
  try {
    toggleFavoriteWorkItem('WI-104', 'user-a')
    assert.deepEqual(getFavoriteWorkItemIds('user-a'), ['WI-104'])
    assert.deepEqual(getFavoriteWorkItemIds('user-b'), [])
    assert.equal(storage.get('grad-client-favorite-work-items:user-a'), '["WI-104"]')
    toggleFavoriteWorkItem('WI-104', 'user-a')
    assert.deepEqual(getFavoriteWorkItemIds('user-a'), [])
    assert.deepEqual(events, ['grad-client-favorites-updated', 'grad-client-favorites-updated'])
    toggleFavoriteWorkItem('WI-104')
    assert.equal(events.length, 2)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
