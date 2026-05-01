import type { FormEvent } from 'react'
import { getNodeTypeLabel } from '../../workspace/model/labels'
import { ORG_NODE_TYPE_OPTIONS } from '../../workspace/model/options'
import type { NodeType, SelectedNodeDetail } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type NodeEditFormProps = {
  selectedDetail: SelectedNodeDetail
  editNodeName: string
  editNodeType: Exclude<NodeType, 'USER'>
  onEditNodeNameChange: (value: string) => void
  onEditNodeTypeChange: (value: Exclude<NodeType, 'USER'>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function NodeEditForm({
  selectedDetail,
  editNodeName,
  editNodeType,
  onEditNodeNameChange,
  onEditNodeTypeChange,
  onSubmit,
}: NodeEditFormProps) {
  return (
    <form className={styles.panel} onSubmit={onSubmit}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Edit Node</p>
          <h3 className={styles.panelTitle}>조직 정보 수정</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>조직 이름</span>
        <input
          className={styles.input}
          value={editNodeName}
          disabled={!selectedDetail.canManage}
          onChange={(event) => onEditNodeNameChange(event.target.value)}
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>조직 유형</span>
        <select
          className={styles.input}
          value={editNodeType}
          disabled={!selectedDetail.canManage}
          onChange={(event) => onEditNodeTypeChange(event.target.value as Exclude<NodeType, 'USER'>)}
        >
          {ORG_NODE_TYPE_OPTIONS.map((type) => (
            <option key={type} value={type}>
              {getNodeTypeLabel(type)}
            </option>
          ))}
        </select>
      </label>

      {!selectedDetail.canManage ? (
        <p className={styles.emptyState}>현재 계정은 이 조직을 읽기 전용으로 확인할 수 있습니다.</p>
      ) : null}

      <button type="submit" className={styles.submitButton} disabled={!selectedDetail.canManage}>
        조직 수정
      </button>
    </form>
  )
}
