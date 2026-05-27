import { useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { WorkItemRecord } from '../../workspace/model/types'
import { BOARD_COLUMNS } from '../model/dashboardView'
import { DashboardEmptyState } from './DashboardEmptyState'
import { DashboardWorkItemCard } from './DashboardWorkItemCard'
import styles from '../pages/DashboardPage.module.css'

const PREVIEW_ITEM_LIMIT = 3

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
  onPreviewHeightChange?: (height: number) => void
}

export function DashboardBoard({ workItems, onPreviewHeightChange }: DashboardBoardProps) {
  const [expandedColumns, setExpandedColumns] = useState<Record<string, boolean>>({})
  const panelRef = useRef<HTMLElement>(null)
  const hasExpandedColumn = Object.values(expandedColumns).some(Boolean)

  useLayoutEffect(() => {
    if (hasExpandedColumn) {
      return undefined
    }

    const panel = panelRef.current

    if (!panel) {
      return undefined
    }

    const updatePreviewHeight = () => {
      onPreviewHeightChange?.(panel.getBoundingClientRect().height)
    }

    updatePreviewHeight()

    const observer = new ResizeObserver(updatePreviewHeight)
    observer.observe(panel)

    return () => {
      observer.disconnect()
    }
  }, [hasExpandedColumn, onPreviewHeightChange, workItems])

  return (
    <section ref={panelRef} className={[styles.panel, styles.boardPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>진행 중인 워크스페이스</h3>
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
                      <DashboardWorkItemCard key={item.workItemId} item={item} />
                    ))}
                    {hasHiddenItems ? (
                      <>
                        {isExpanded ? (
                          <div className={styles.moreItemsDropdown}>
                            {hiddenItems.map((item) => (
                              <DashboardWorkItemCard key={item.workItemId} item={item} />
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
