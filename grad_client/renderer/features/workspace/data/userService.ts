import type { SignInRequest, SignInResponse, SignUpRequest, WorkspaceDatabase } from '../model/types'
import {
  confirmSignupEmailVerificationOnServer,
  getCurrentServerUser,
  requestPasswordResetOnServer,
  requestSignupEmailVerificationOnServer,
  signInServerUser,
  signOutServerUser,
  signUpServerUser,
} from './serverWorkspace.js'
import { createServerEntityId } from './server/serverId.js'

export function getNextGeneratedUserId() {
  return createServerEntityId('U')
}

export function getCurrentUser(workspace?: Pick<WorkspaceDatabase, 'users'>) {
  return getCurrentServerUser(workspace)
}

export async function signInUser(payload: SignInRequest): Promise<SignInResponse> {
  return signInServerUser(payload)
}

export async function signUpUser(payload: SignUpRequest) {
  return signUpServerUser(payload)
}

export function requestPasswordReset(email: string) {
  return requestPasswordResetOnServer(email)
}

export function requestSignupEmailVerification(email: string) {
  return requestSignupEmailVerificationOnServer(email)
}

export function confirmSignupEmailVerification(email: string, code: string) {
  return confirmSignupEmailVerificationOnServer(email, code)
}

export function signOutUser() {
  signOutServerUser()
}
