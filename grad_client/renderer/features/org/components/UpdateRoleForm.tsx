import type { FormEvent } from 'react'
import type { AuthorityRecord } from '../../workspace/model/types'
import type { RoleName, SelectedNodeDetail } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type UpdateRoleFormProps = {
  roleDefinitions: AuthorityRecord[]
  selectedDetail: SelectedNodeDetail
  updateRoleEmail: string
  updateRoleName: RoleName
  busy?: boolean
  onUpdateRoleEmailChange: (value: string) => void
  onUpdateRoleNameChange: (value: RoleName) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function UpdateRoleForm({
  roleDefinitions,
  selectedDetail,
  updateRoleEmail,
  updateRoleName,
  busy = false,
  onUpdateRoleEmailChange,
  onUpdateRoleNameChange,
  onSubmit,
}: UpdateRoleFormProps) {
  const editableMembers = selectedDetail.directRoles.filter((role) => !role.isTopRole)
  const isDisabled = !selectedDetail.canManage || editableMembers.length === 0 || busy

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
          {editableMembers.map((role) => (
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
          <option value="">역할 선택</option>
          {roleDefinitions.filter((role) => !role.isTopRole).map((role) => (
            <option key={role.id} value={String(role.id)}>
              {role.roleName}
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
