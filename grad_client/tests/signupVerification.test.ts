import assert from 'node:assert/strict'
import test from 'node:test'
import {
  confirmSignupEmailVerificationOnServer,
  requestSignupEmailVerificationOnServer,
  signUpServerUser,
} from '../renderer/features/workspace/data/server/serverWorkspace.js'

type CapturedCall = {
  pathname: string
  method: string
  body: Record<string, unknown> | undefined
  authorization: string | null
}

function captureCall(
  calls: CapturedCall[],
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) {
  const url = new URL(String(input instanceof Request ? input.url : input))
  const rawBody = init?.body
  calls.push({
    pathname: url.pathname,
    method: String(init?.method ?? 'GET').toUpperCase(),
    body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined,
    authorization: new Headers(init?.headers).get('Authorization'),
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

test('회원가입 인증번호 요청은 이메일을 정규화하고 인증 토큰 없이 보낸다', async () => {
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)
    return jsonResponse({
      status: 'success',
      message: '인증번호를 보냈습니다. 메일이 보이지 않으면 스팸함을 확인해 주세요.',
    })
  }

  try {
    const result = await requestSignupEmailVerificationOnServer('  USER@Example.com ')

    assert.deepEqual(result, {
      status: 'success',
      message: '인증번호를 보냈습니다. 메일이 보이지 않으면 스팸함을 확인해 주세요.',
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].pathname, '/api/users/email-verification/request')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].authorization, null)
    assert.deepEqual(calls[0].body, { email: 'user@example.com' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('회원가입 인증번호 확인은 발급된 인증 완료 토큰을 그대로 반환한다', async () => {
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []
  const verificationToken = 'a'.repeat(64)

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)
    return jsonResponse({
      status: 'success',
      message: '이메일 인증이 완료되었습니다.',
      verification_token: verificationToken,
      expires_in_minutes: 15,
    })
  }

  try {
    const result = await confirmSignupEmailVerificationOnServer(' USER@Example.com ', ' 123456 ')

    assert.deepEqual(result, {
      status: 'success',
      message: '이메일 인증이 완료되었습니다.',
      verificationToken,
      expiresInMinutes: 15,
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].pathname, '/api/users/email-verification/confirm')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].authorization, null)
    assert.deepEqual(calls[0].body, { email: 'user@example.com', code: '123456' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('회원가입은 인증 완료 토큰과 정규화된 프로필을 signup 경로로 보낸다', async () => {
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []
  const verificationToken = 'b'.repeat(64)

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)

    if (calls.length === 1) {
      return jsonResponse({ status: 'success', message: '회원가입이 완료되었습니다.' }, 201)
    }

    return jsonResponse({ status: 'error', message: '로그인에 실패했습니다.' }, 401)
  }

  try {
    const result = await signUpServerUser({
      userId: ' User_1 ',
      email: ' USER@Example.com ',
      name: ' 홍길동 ',
      password: 'Abcd123!',
      verificationToken,
    })

    assert.equal(result.status, 'error')
    assert.equal('accountCreated' in result && result.accountCreated, true)
    assert.equal(calls.length, 2)
    assert.equal(calls[0].pathname, '/api/users/signup')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].authorization, null)
    assert.deepEqual(calls[0].body, {
      user_id: 'User_1',
      email: 'user@example.com',
      name: '홍길동',
      password: 'Abcd123!',
      verification_token: verificationToken,
    })
    assert.equal(calls[1].pathname, '/api/users/login')
    assert.equal(calls[1].authorization, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
