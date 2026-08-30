import type { FormEvent } from 'react'
import { getNodeTypeLabel } from '../../workspace/model/labels'
import { SUB_NODE_TYPE_OPTIONS } from '../../workspace/model/options'
import type { NodeType, UserRecord } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type CreateSubNodeFormProps = {
  managerEmail: string
  subNodeName: string
  subNodeType: Exclude<NodeType, 'USER'>
  users: UserRecord[]
  allowCustomManagerEmail?: boolean
  disabled?: boolean
  busy?: boolean
  onManagerEmailChange: (value: string) => void
  onSubNodeNameChange: (value: string) => void
  onSubNodeTypeChange: (value: Exclude<NodeType, 'USER'>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function CreateSubNodeForm({
  managerEmail,
  subNodeName,
  subNodeType,
  users,
  allowCustomManagerEmail = false,
  disabled = false,
  busy = false,
  onManagerEmailChange,
  onSubNodeNameChange,
  onSubNodeTypeChange,
  onSubmit,
}: CreateSubNodeFormProps) {
  return (
    <form className={styles.panel} onSubmit={onSubmit} aria-busy={busy}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Create Sub Node</p>
          <h3 className={styles.panelTitle}>하위 조직 만들기</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>조직 유형</span>
        <select
          className={styles.input}
          value={subNodeType}
          disabled={disabled}
          onChange={(event) => onSubNodeTypeChange(event.target.value as Exclude<NodeType, 'USER'>)}
        >
          {SUB_NODE_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {getNodeTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        <span className={styles.label}>조직 이름</span>
        <input
          className={styles.input}
          value={subNodeName}
          disabled={disabled}
          required
          onChange={(event) => onSubNodeNameChange(event.target.value)}
          placeholder="예: 프론트엔드, 백엔드, 발표 준비"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>관리자</span>
        {allowCustomManagerEmail ? (
          <>
            <input
              type="email"
              list="sub-node-manager-email-options"
              className={styles.input}
              value={managerEmail}
              disabled={disabled}
              required
              onChange={(event) => onManagerEmailChange(event.target.value)}
              placeholder="등록된 사용자 이메일"
            />
            <datalist id="sub-node-manager-email-options">
              {users.map((member) => (
                <option key={member.userId} value={member.email}>{member.name}</option>
              ))}
            </datalist>
          </>
        ) : (
          <select
            className={styles.input}
            value={managerEmail}
            disabled={disabled}
            required
            onChange={(event) => onManagerEmailChange(event.target.value)}
          >
            {users.map((member) => (
              <option key={member.userId} value={member.email}>
                {member.name} ({member.userId})
              </option>
            ))}
          </select>
        )}
      </label>

      <div className={styles.callout}>
        <p className={styles.panelEyebrow}>기본 권한</p>
        <strong>ADMIN</strong>
        <p className={styles.calloutText}>새 하위 조직의 관리자는 기본으로 ADMIN 권한을 받습니다.</p>
      </div>

      <button type="submit" className={styles.submitButton} disabled={disabled}>
        {busy ? '추가 중...' : '하위 조직 추가'}
      </button>
    </form>
  )
}
