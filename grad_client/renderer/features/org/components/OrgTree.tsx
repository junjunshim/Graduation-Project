import { getNodeTypeLabel } from '../../workspace/model/labels'
import type { OrganizationNodeRecord } from '../../workspace/model/types'
import styles from '../pages/OrgManagePage.module.css'

type OrgTreeProps = {
  nodes: OrganizationNodeRecord[]
  rootNodes: OrganizationNodeRecord[]
  selectedNodeId: number | null
  onSelect: (nodeId: number) => void
}

function TreeBranch({
  nodeId,
  selectedNodeId,
  onSelect,
  nodes,
}: {
  nodeId: number
  selectedNodeId: number | null
  onSelect: (nodeId: number) => void
  nodes: OrganizationNodeRecord[]
}) {
  const node = nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return null
  }

  const children = nodes.filter((candidate) => candidate.parentNodeId === node.id)

  return (
    <li className={styles.treeItem}>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        className={[styles.treeButton, node.id === selectedNodeId ? styles.treeButtonActive : '']
          .filter(Boolean)
          .join(' ')}
      >
        <div className={styles.treeButtonCopy}>
          <strong>{node.name}</strong>
          <span className={styles.treeButtonMeta}>{getNodeTypeLabel(node.nodeType)}</span>
        </div>
        <span className={styles.treeBadge}>{node.path.length - 1}단계</span>
      </button>

      {children.length > 0 ? (
        <ul className={styles.treeChildren}>
          {children.map((child) => (
            <TreeBranch
              key={child.id}
              nodeId={child.id}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              nodes={nodes}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function OrgTree({ nodes, rootNodes, selectedNodeId, onSelect }: OrgTreeProps) {
  return (
    <section className={[styles.panel, styles.treePanel].join(' ')}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Tree View</p>
          <h3 className={styles.panelTitle}>접근 가능한 조직</h3>
        </div>
      </div>

      <div className={styles.treeViewport}>
        <ul className={styles.tree}>
          {rootNodes.map((node) => (
            <TreeBranch
              key={node.id}
              nodeId={node.id}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              nodes={nodes}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
