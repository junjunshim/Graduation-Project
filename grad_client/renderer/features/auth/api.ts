import {
  getCurrentUser as getCurrentUserWorkspace,
  getNextGeneratedUserId,
  requestPasswordReset as requestPasswordResetUser,
  signInUser,
  signOutUser,
  signUpUser,
} from '../workspace/data/userService'
import type { SignInRequest, SignUpRequest, WorkspaceSnapshot } from '../workspace/model/types'

export function getCurrentUser(workspace?: Pick<WorkspaceSnapshot, 'users'>) {
  return getCurrentUserWorkspace(workspace)
}

export function signIn(payload: SignInRequest) {
  return signInUser(payload)
}

export function signUp(payload: SignUpRequest) {
  return signUpUser(payload)
}

export function signOut() {
  signOutUser()
}

export function requestPasswordReset(email: string) {
  return requestPasswordResetUser(email)
}

export function getSuggestedUserId() {
  return getNextGeneratedUserId()
}
