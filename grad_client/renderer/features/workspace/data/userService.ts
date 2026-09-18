import type { SignInRequest, SignInResponse, SignUpRequest, WorkspaceDatabase } from '../model/types'
import { getCurrentServerUser, signInServerUser, signOutServerUser, signUpServerUser } from './serverWorkspace'
import { createServerEntityId } from './server/serverId'

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

export function signOutUser() {
  signOutServerUser()
}
