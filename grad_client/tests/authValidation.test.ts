import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getEmailValidationError,
  getPasswordValidationError,
  normalizeEmailInput,
} from '../renderer/features/auth/model/authValidation.js'

test('email validation matches the signup and reset contract', () => {
  assert.equal(getEmailValidationError(''), '이메일 주소를 입력해 주세요.')
  assert.equal(getEmailValidationError('not-an-email'), '올바른 이메일 형식을 입력해 주세요. (예: user@example.com)')
  assert.equal(getEmailValidationError('user@example.com'), null)
  assert.equal(getEmailValidationError(`${'a'.repeat(101)}@example.com`), '이메일 주소는 최대 100자까지 입력할 수 있습니다.')
  assert.equal(normalizeEmailInput('  USER@Example.com  '), 'user@example.com')
})

test('password validation requires length, letters, numbers, and a special character', () => {
  assert.equal(getPasswordValidationError(''), '비밀번호를 입력해 주세요.')
  assert.equal(getPasswordValidationError('Ab1!'), '비밀번호는 최소 8자 이상이어야 합니다.')
  assert.equal(getPasswordValidationError('abcdefg1!'), null)
  assert.equal(
    getPasswordValidationError('abcdefgh!'),
    '비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.',
  )
  assert.equal(
    getPasswordValidationError('abcdefg1'),
    '비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.',
  )
})
