import {
  enterDemoWorkspace as enterDemoWorkspaceWorkspace,
  getCurrentUser as getCurrentUserWorkspace,
  getNextGeneratedUserId,
  signInUser,
  signOutUser,
  signUpUser,
} from '../workspace/data/userService'
import type { SignInRequest, SignUpRequest } from '../workspace/model/types'

export function getCurrentUser() {
  return getCurrentUserWorkspace()
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

export function enterDemoWorkspace() {
  return enterDemoWorkspaceWorkspace()
}

export function getSuggestedUserId() {
  return getNextGeneratedUserId()
}
