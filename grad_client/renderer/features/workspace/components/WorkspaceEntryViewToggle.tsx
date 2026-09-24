import { Button, ButtonLink } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './WorkspaceEntryViewToggle.module.css'

export type WorkspaceEntryView = 'hierarchy' | 'list'

type WorkspaceEntryViewToggleProps = {
  view: WorkspaceEntryView
  onChange: (view: WorkspaceEntryView) => void
  onOpenChooser?: () => void
  isAllExpanded?: boolean
  onToggleExpandAll?: () => void
  /** 휴지통 모드(삭제된 워크스페이스를 같은 화면에 흐릿하게 함께 보기) 여부 */
  isTrashMode?: boolean
  /** 휴지통에 담긴 워크스페이스 수 */
  deletedCount?: number
  /** 살아있는 워크스페이스가 없어 휴지통 모드를 끌 수 없는 상태 */
  isTrashModeLocked?: boolean
  onToggleTrash?: () => void
}

export function WorkspaceEntryViewToggle({
  view,
  onChange,
  onOpenChooser,
  isAllExpanded = false,
  onToggleExpandAll,
  isTrashMode = false,
  deletedCount = 0,
  isTrashModeLocked = false,
  onToggleTrash,
}: WorkspaceEntryViewToggleProps) {
  return (
    <div className={styles.viewToggleBar} aria-label="워크스페이스 진입점 도구 모음">
      <div className={styles.viewGroup}>
        <div className={styles.viewSegmentGroup} role="group" aria-label="워크스페이스 보기 방식">
          <Button
            variant={view === 'hierarchy' ? 'primary' : 'secondary'}
            className={[styles.viewSegmentButton, view === 'hierarchy' ? styles.viewSegmentActive : ''].join(' ')}
            aria-pressed={view === 'hierarchy'}
            onClick={() => onChange('hierarchy')}
          >
            <Icon name="orgChart" size={17} />
            계층도 보기
          </Button>
          <Button
            variant={view === 'list' ? 'primary' : 'secondary'}
            className={[styles.viewSegmentButton, view === 'list' ? styles.viewSegmentActive : ''].join(' ')}
            aria-pressed={view === 'list'}
            onClick={() => onChange('list')}
          >
            <Icon name="list" size={17} />
            목록 보기
          </Button>
        </div>

        {view === 'hierarchy' && onToggleExpandAll ? (
          <Button
            variant="secondary"
            className={styles.expandAllButton}
            aria-pressed={isAllExpanded}
            title={isAllExpanded ? '모든 하위 워크스페이스를 접습니다.' : '모든 하위 워크스페이스를 펼칩니다.'}
            onClick={onToggleExpandAll}
          >
            <Icon name={isAllExpanded ? 'chevronUp' : 'chevronDown'} size={17} />
            {isAllExpanded ? '전체 접기' : '전체 펼치기'}
          </Button>
        ) : null}
      </div>

      <div className={styles.actionGroup}>
        {onToggleTrash ? (
          <Button
            variant={isTrashMode ? 'primary' : 'secondary'}
            className={styles.chooserButton}
            aria-pressed={isTrashMode}
            disabled={isTrashModeLocked}
            title={
              isTrashModeLocked
                ? '모든 워크스페이스가 삭제되어 휴지통 모드로 고정되었습니다.'
                : isTrashMode
                  ? '삭제된 워크스페이스를 숨깁니다.'
                  : '삭제된 워크스페이스를 같은 화면에 흐릿하게 표시합니다. (우클릭으로 복구)'
            }
            onClick={onToggleTrash}
          >
            <Icon name="trash" size={17} />
            {isTrashModeLocked
              ? `휴지통 고정 (${deletedCount})`
              : isTrashMode
                ? '휴지통 닫기'
                : `휴지통${deletedCount > 0 ? ` (${deletedCount})` : ''}`}
          </Button>
        ) : null}
        {onOpenChooser ? (
          <Button
            variant="secondary"
            className={styles.chooserButton}
            onClick={onOpenChooser}
          >
            <Icon name="building" size={17} />
            루트 워크스페이스 선택
          </Button>
        ) : null}
        <ButtonLink to="/setup/top-node" className={styles.createButton} variant="primary">
          <Icon name="plus" size={16} />
          워크스페이스 생성
        </ButtonLink>
      </div>
    </div>
  )
}