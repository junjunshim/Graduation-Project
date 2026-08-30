import type { FormEvent } from 'react'
import { ROLE_OPTIONS } from '../../workspace/model/options'
import type { RoleName, SelectedNodeDetail } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type UpdateRoleFormProps = {
  selectedDetail: SelectedNodeDetail
  updateRoleEmail: string
  updateRoleName: RoleName
  busy?: boolean
  onUpdateRoleEmailChange: (value: string) => void
  onUpdateRoleNameChange: (value: RoleName) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function UpdateRoleForm({
  selectedDetail,
  updateRoleEmail,
  updateRoleName,
  busy = false,
  onUpdateRoleEmailChange,
  onUpdateRoleNameChange,
  onSubmit,
}: UpdateRoleFormProps) {
  const isDisabled = !selectedDetail.canManage || selectedDetail.directRoles.length === 0 || busy

  return (
    <form className={styles.panel} onSubmit={onSubmit} aria-busy={busy}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Update Role</p>
          <h3 className={styles.panelTitle}>기존 권한 변경</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>사용자</span>
        <select
          className={styles.input}
          value={updateRoleEmail}
          disabled={isDisabled}
          onChange={(event) => onUpdateRoleEmailChange(event.target.value)}
        >
          {selectedDetail.directRoles.map((role) => (
            <option key={role.assignmentId} value={role.email}>
              {role.name} ({role.email})
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>권한</span>
        <select
          className={styles.input}
          value={updateRoleName}
          disabled={isDisabled}
          onChange={(event) => onUpdateRoleNameChange(event.target.value as RoleName)}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className={styles.submitButton} disabled={isDisabled}>
        {busy ? '처리 중...' : '권한 변경'}
      </button>
    </form>
  )
}
