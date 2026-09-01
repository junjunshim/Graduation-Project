import type { FormEvent } from 'react'
import { ROLE_OPTIONS } from '../../workspace/model/options'
import type { RoleName, UserRecord } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type AssignRoleFormProps = {
  assignRoleName: RoleName
  roleEmail: string
  users: UserRecord[]
  allowCustomEmail?: boolean
  disabled?: boolean
  busy?: boolean
  onAssignRoleNameChange: (value: RoleName) => void
  onRoleEmailChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AssignRoleForm({
  assignRoleName,
  roleEmail,
  users,
  allowCustomEmail = false,
  disabled = false,
  busy = false,
  onAssignRoleNameChange,
  onRoleEmailChange,
  onSubmit,
}: AssignRoleFormProps) {
  return (
    <form className={styles.panel} onSubmit={onSubmit} aria-busy={busy}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Assign Role</p>
          <h3 className={styles.panelTitle}>사용자에게 권한 부여</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>사용자</span>
        {allowCustomEmail ? (
          <>
            <input
              type="email"
              list="assign-role-email-options"
              className={styles.input}
              value={roleEmail}
              disabled={disabled}
              required
              onChange={(event) => onRoleEmailChange(event.target.value)}
              placeholder="등록된 사용자 이메일"
            />
            <datalist id="assign-role-email-options">
              {users.map((member) => (
                <option key={member.userId} value={member.email}>{member.name}</option>
              ))}
            </datalist>
          </>
        ) : (
          <select
            className={styles.input}
            value={roleEmail}
            disabled={disabled}
            required
            onChange={(event) => onRoleEmailChange(event.target.value)}
          >
            {users.map((member) => (
              <option key={member.userId} value={member.email}>
                {member.name} ({member.userId})
              </option>
            ))}
          </select>
        )}
      </label>

      <label className={styles.field}>
        <span className={styles.label}>권한</span>
        <select
          className={styles.input}
          value={assignRoleName}
          disabled={disabled}
          onChange={(event) => onAssignRoleNameChange(event.target.value as RoleName)}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className={styles.submitButton} disabled={disabled}>
        {busy ? '추가 중...' : '권한 추가'}
      </button>
    </form>
  )
}
