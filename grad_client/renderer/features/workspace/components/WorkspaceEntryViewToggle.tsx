import { Button, ButtonLink } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './WorkspaceEntryViewToggle.module.css'

export type WorkspaceEntryView = 'hierarchy' | 'list'

type WorkspaceEntryViewToggleProps = {
  view: WorkspaceEntryView
  onChange: (view: WorkspaceEntryView) => void
  onOpenChooser?: () => void
}

export function WorkspaceEntryViewToggle({ view, onChange, onOpenChooser }: WorkspaceEntryViewToggleProps) {
  return (
    <div className={styles.viewToggleBar} aria-label="워크스페이스 진입점 도구 모음">
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

      <div className={styles.actionGroup}>
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
