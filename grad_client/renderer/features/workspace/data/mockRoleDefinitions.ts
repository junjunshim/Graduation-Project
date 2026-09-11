import { DEFAULT_ROLE_AUTHORITIES } from '../model/authorityDefinitions'
import { resolveRoleAssignments } from '../model/roleDefinitions'
import type { StandardRoleName, WorkspaceDatabase } from '../model/types'

/** Upgrade only local mock fixtures. Server data must always supply role IDs. */
export function ensureMockRoleDefinitions(db: WorkspaceDatabase): WorkspaceDatabase {
  const definitions = db.authorities ?? []
  let nextId = Math.max(0, ...definitions.map((a) => a.id)) + 1
  for (const node of db.nodes) {
    if (definitions.some((a) => a.nodeId === node.id)) continue
    for (const name of Object.keys(DEFAULT_ROLE_AUTHORITIES) as StandardRoleName[]) {
      if (!definitions.some((a) => a.nodeId === node.id && a.roleName === name)) {
        definitions.push({ id: nextId++, nodeId: node.id, roleName: name, authority: DEFAULT_ROLE_AUTHORITIES[name], isTopRole: name === 'ADMIN' })
      }
    }
  }
  for (const definition of definitions) {
    if (definition.isTopRole === undefined) definition.isTopRole = definition.roleName === 'ADMIN'
  }
  for (const assignment of db.roles) {
    if (assignment.roleId !== undefined) continue
    let definition = definitions.find((a) => a.nodeId === assignment.nodeId && a.roleName === assignment.roleName)
    if (!definition) {
      definition = { id: nextId++, nodeId: assignment.nodeId, roleName: assignment.roleName, authority: DEFAULT_ROLE_AUTHORITIES.MEMBER, isTopRole: false }
      definitions.push(definition)
    }
    assignment.roleId = definition.id
  }
  db.authorities = definitions
  db.roles = resolveRoleAssignments(db.roles, definitions)
  return db
}
