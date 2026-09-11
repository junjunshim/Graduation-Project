import type { AuthorityRecord, RoleAssignmentRecord } from './types'

export function resolveRoleAssignments(roles: RoleAssignmentRecord[], authorities: AuthorityRecord[]): RoleAssignmentRecord[] {
  const definitions = new Map(authorities.map((definition) => [definition.id, definition]))
  return roles.map((assignment) => {
    const definition = assignment.roleId === undefined ? undefined : definitions.get(assignment.roleId)
    return {
      ...assignment,
      roleName: definition?.nodeId === assignment.nodeId ? definition.roleName : '역할 정보 없음',
      isTopRole: definition?.nodeId === assignment.nodeId && definition.isTopRole === true,
    }
  })
}
