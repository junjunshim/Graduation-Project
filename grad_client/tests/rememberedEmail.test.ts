import assert from 'node:assert/strict'
import test from 'node:test'
import {
  REMEMBERED_EMAIL_STORAGE_KEY,
  readRememberedEmail,
  saveRememberedEmail,
} from '../renderer/features/auth/model/rememberedEmail.js'

test('remembered login email is restored, saved after login, and removed when unchecked', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }

  assert.equal(readRememberedEmail(storage), '')

  saveRememberedEmail('  user@example.com  ', true, storage)
  assert.equal(values.get(REMEMBERED_EMAIL_STORAGE_KEY), 'user@example.com')
  assert.equal(readRememberedEmail(storage), 'user@example.com')

  saveRememberedEmail('user@example.com', false, storage)
  assert.equal(values.has(REMEMBERED_EMAIL_STORAGE_KEY), false)
  assert.equal(readRememberedEmail(storage), '')
})

test('remembered email storage failures do not block the login flow', () => {
  const storage = {
    getItem: () => {
      throw new Error('storage unavailable')
    },
    removeItem: () => {
      throw new Error('storage unavailable')
    },
    setItem: () => {
      throw new Error('storage unavailable')
    },
  }

  assert.equal(readRememberedEmail(storage), '')
  assert.doesNotThrow(() => saveRememberedEmail('user@example.com', true, storage))
  assert.doesNotThrow(() => saveRememberedEmail('user@example.com', false, storage))
})
