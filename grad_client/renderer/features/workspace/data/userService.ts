import type { SignInRequest, SignInResponse, SignUpRequest } from '../model/types'
import { delay, generateUserId, getUserByEmail, nowIso, readWorkspaceDb, writeWorkspaceDb } from './localStore'
import { getCurrentServerUser, signInServerUser, signOutServerUser, signUpServerUser } from './serverWorkspace'
import { TEAM_404_DEMO_USER_ID } from './seed'
import { getCurrentSessionUserId, setCurrentSessionUserId } from './session'
import { isServerDataSource } from './workspaceMode'

export function getNextGeneratedUserId() {
  return generateUserId(readWorkspaceDb())
}

export function getDemoWorkspaceUser() {
  return readWorkspaceDb().users.find((user) => user.userId === TEAM_404_DEMO_USER_ID) ?? null
}

export function enterDemoWorkspace() {
  if (isServerDataSource()) {
    return {
      status: 'error' as const,
      message: '서버 모드에서는 데모 워크스페이스 대신 실제 계정으로 로그인해 주세요.',
    }
  }

  const demoUser = getDemoWorkspaceUser()

  if (!demoUser) {
    return {
      status: 'error' as const,
      message: '데모 워크스페이스 사용자를 찾을 수 없습니다.',
    }
  }

  setCurrentSessionUserId(demoUser.userId)

  return {
    status: 'success' as const,
    user: demoUser,
  }
}

export function getCurrentUser() {
  if (isServerDataSource()) {
    return getCurrentServerUser()
  }

  const db = readWorkspaceDb()
  const sessionUserId = getCurrentSessionUserId()

  if (!sessionUserId) {
    return null
  }

  return db.users.find((user) => user.userId === sessionUserId) ?? null
}

export async function signInUser(payload: SignInRequest): Promise<SignInResponse> {
  if (isServerDataSource()) {
    return signInServerUser(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const email = payload.email.trim().toLowerCase()
  const password = payload.password.trim()

  if (!email || !password) {
    return {
      status: 'error',
      message: '이메일과 비밀번호를 입력해 주세요.',
    }
  }

  const user = getUserByEmail(email, db.users)

  if (!user || user.password !== password) {
    return {
      status: 'error',
      message: '이메일 또는 비밀번호가 올바르지 않습니다.',
    }
  }

  setCurrentSessionUserId(user.userId)

  return {
    status: 'success',
    user,
  }
}

export async function signUpUser(payload: SignUpRequest) {
  if (isServerDataSource()) {
    return signUpServerUser(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const userId = payload.userId.trim() || generateUserId(db)
  const email = payload.email.trim().toLowerCase()
  const name = payload.name.trim()
  const password = payload.password.trim()

  if (!email || !name || !password) {
    return {
      status: 'error' as const,
      message: '모든 필수 입력값을 채워야 합니다.',
    }
  }

  if (db.users.some((user) => user.userId === userId)) {
    return {
      status: 'error' as const,
      message: '이미 사용 중인 userId입니다.',
    }
  }

  if (db.users.some((user) => user.email.toLowerCase() === email)) {
    return {
      status: 'error' as const,
      message: '이미 가입된 이메일입니다.',
    }
  }

  const timestamp = nowIso()
  const personalNodeId = db.counters.node
  db.counters.node += 1

  db.users.push({
    userId,
    email,
    name,
    password,
    personalNodeId,
    createdAt: timestamp,
  })

  db.nodes.push({
    id: personalNodeId,
    nodeType: 'USER',
    name: `${name} 개인공간`,
    path: [personalNodeId],
    createdAt: timestamp,
  })

  db.roles.push({
    id: db.counters.role,
    userId,
    nodeId: personalNodeId,
    roleName: 'ADMIN',
    createdAt: timestamp,
  })
  db.counters.role += 1

  writeWorkspaceDb(db)
  setCurrentSessionUserId(userId)

  return {
    status: 'success' as const,
    message: `${name} 계정과 개인공간이 생성되었습니다.`,
    userId,
  }
}

export function signOutUser() {
  if (isServerDataSource()) {
    signOutServerUser()
    return
  }

  setCurrentSessionUserId(null)
}
