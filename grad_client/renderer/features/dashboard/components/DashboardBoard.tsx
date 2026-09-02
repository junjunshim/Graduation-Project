import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { UserRecord, WorkItemRecord } from '../../workspace/model/types'
import { BOARD_COLUMNS } from '../model/dashboardView'
import { DashboardEmptyState } from './DashboardEmptyState'
import { DashboardWorkItemCard } from './DashboardWorkItemCard'
import styles from '../pages/DashboardPage.module.css'

const PREVIEW_ITEM_LIMIT = 5

function getColumnHeaderToneClassName(columnId: string) {
  if (columnId === 'in-progress') {
    return styles.columnHeaderInProgress
  }

  if (columnId === 'todo') {
    return styles.columnHeaderTodo
  }

  return styles.columnHeaderDone
}

type DashboardBoardProps = {
  workItems: WorkItemRecord[]
  users: UserRecord[]
}

export function DashboardBoard({ workItems, users }: DashboardBoardProps) {
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({})

  return (
    <section className={[styles.panel, styles.boardPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>업무 현황</h3>
        </div>
        <Link to="/org/manage" className={[styles.inlineLink, styles.boardViewLink].join(' ')}>
          전체 보기
          <Icon name="chevronRight" size={15} />
        </Link>
      </div>

      <div className={styles.boardColumns}>
        {BOARD_COLUMNS.map((column) => {
          const columnItems = workItems.filter((item) => item.status === column.id)
          const previewItems = columnItems.slice(0, PREVIEW_ITEM_LIMIT)
          const hiddenItems = columnItems.slice(PREVIEW_ITEM_LIMIT)
          const isExpanded = Boolean(expandedColumns[column.id])
          const hasHiddenItems = hiddenItems.length > 0

          const toggleColumn = () => {
            setExpandedColumns((current) => ({
              ...current,
              [column.id]: !current[column.id],
            }))
          }

          return (
            <section key={column.id} className={styles.boardColumn}>
              <div className={[styles.columnHeader, getColumnHeaderToneClassName(column.id)].join(' ')}>
                <h4>{column.title}</h4>
                <strong>{columnItems.length}</strong>
              </div>

              <div className={styles.taskStack}>
                {columnItems.length > 0 ? (
                  <>
                    {previewItems.map((item) => (
                      <DashboardWorkItemCard key={item.workItemId} item={item} users={users} />
                    ))}
                    {hasHiddenItems ? (
                      <>
                        {isExpanded ? (
                          <div className={styles.moreItemsDropdown}>
                            {hiddenItems.map((item) => (
                              <DashboardWorkItemCard key={item.workItemId} item={item} users={users} />
                            ))}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className={styles.moreItemsButton}
                          onClick={toggleColumn}
                          aria-expanded={isExpanded}
                        >
                          <Icon name={isExpanded ? 'chevronDown' : 'plus'} size={14} />
                          {isExpanded ? '접기' : `더 보기`}
                        </button>
                      </>
                    ) : null}
                  </>
                ) : (
                  <DashboardEmptyState>표시할 업무가 없습니다.</DashboardEmptyState>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
