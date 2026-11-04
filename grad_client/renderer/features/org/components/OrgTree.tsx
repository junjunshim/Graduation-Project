import { useMemo } from 'react'
import { getNodeTypeLabel } from '../../workspace/model/labels'
import type { OrganizationNodeRecord } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type OrgTreeProps = {
  nodes: OrganizationNodeRecord[]
  rootNodes: OrganizationNodeRecord[]
  selectedNodeId: number | null
  searchQuery: string
  onSearchChange: (value: string) => void
  onSelect: (nodeId: number) => void
}

function TreeBranch({
  node,
  childrenByParentId,
  selectedNodeId,
  onSelect,
}: {
  node: OrganizationNodeRecord
  childrenByParentId: ReadonlyMap<number, OrganizationNodeRecord[]>
  selectedNodeId: number | null
  onSelect: (nodeId: number) => void
}) {
  const children = childrenByParentId.get(node.id) ?? []

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
              node={child}
              childrenByParentId={childrenByParentId}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function OrgTree({ nodes, rootNodes, selectedNodeId, searchQuery, onSearchChange, onSelect }: OrgTreeProps) {
  const childrenByParentId = useMemo(() => {
    const index = new Map<number, OrganizationNodeRecord[]>()

    nodes.forEach((node) => {
      if (node.parentNodeId === undefined) {
        return
      }

      const children = index.get(node.parentNodeId)
      if (children) {
        children.push(node)
      } else {
        index.set(node.parentNodeId, [node])
      }
    })

    return index
  }, [nodes])

  return (
    <section className={[styles.panel, styles.treePanel].join(' ')}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Tree View</p>
          <h3 className={styles.panelTitle}>접근 가능한 조직</h3>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.label}>검색</span>
        <input
          className={styles.input}
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="조직 이름 또는 유형"
        />
      </label>

      <div className={styles.treeViewport}>
        <ul className={styles.tree}>
          {rootNodes.map((node) => (
            <TreeBranch
              key={node.id}
              node={node}
              childrenByParentId={childrenByParentId}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      </div>
    </section>
  )
}
