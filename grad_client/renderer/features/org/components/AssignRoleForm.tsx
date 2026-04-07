import type { FormEvent } from 'react'
import type { RoleName, UserRecord } from '../../workspace/model/types'
import styles from '../pages/OrgManagePage.module.css'

const roleOptions: RoleName[] = ['ADMIN', 'MANAGER', 'MEMBER']

type AssignRoleFormProps = {
  assignRoleName: RoleName
  roleEmail: string
  users: UserRecord[]
  onAssignRoleNameChange: (value: RoleName) => void
  onRoleEmailChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AssignRoleForm({
  assignRoleName,
  roleEmail,
  users,
  onAssignRoleNameChange,
  onRoleEmailChange,
  onSubmit,
}: AssignRoleFormProps) {
  return (
    <form className={styles.panel} onSubmit={onSubmit}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Assign Role</p>
          <h3 className={styles.panelTitle}>사용자에게 권한 부여</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>사용자</span>
        <select className={styles.input} value={roleEmail} onChange={(event) => onRoleEmailChange(event.target.value)}>
          {users.map((member) => (
            <option key={member.userId} value={member.email}>
              {member.name} ({member.userId})
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>권한</span>
        <select
          className={styles.input}
          value={assignRoleName}
          onChange={(event) => onAssignRoleNameChange(event.target.value as RoleName)}
        >
          {roleOptions.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className={styles.submitButton}>
        권한 추가
      </button>
    </form>
  )
}
