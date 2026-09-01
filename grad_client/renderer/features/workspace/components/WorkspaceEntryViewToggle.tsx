import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './WorkspaceEntryViewToggle.module.css'

export type WorkspaceEntryView = 'hierarchy' | 'list'

type WorkspaceEntryViewToggleProps = {
  view: WorkspaceEntryView
  onChange: (view: WorkspaceEntryView) => void
}

export function WorkspaceEntryViewToggle({ view, onChange }: WorkspaceEntryViewToggleProps) {
  return (
    <div className={styles.viewToggle} role="group" aria-label="워크스페이스 보기 방식">
      <Button
        variant="secondary"
        className={styles.viewButton}
        aria-pressed={view === 'hierarchy'}
        onClick={() => onChange('hierarchy')}
      >
        <Icon name="orgChart" size={19} />
        계층도 보기
      </Button>
      <Button
        variant="secondary"
        className={styles.viewButton}
        aria-pressed={view === 'list'}
        onClick={() => onChange('list')}
      >
        <Icon name="list" size={19} />
        목록 보기
      </Button>
    </div>
  )
}
