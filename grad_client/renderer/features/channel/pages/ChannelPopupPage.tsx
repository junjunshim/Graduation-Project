import { WindowTitleBar } from '../../../app/chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../../../app/chrome/windowControls'
import { ChannelsPage } from './ChannelsPage'
import styles from './ChannelPopupPage.module.css'

export function ChannelPopupPage() {
  const hasCustomTitleBar = hasCustomWindowControls()

  return (
    <div
      className={[styles.popupShell, hasCustomTitleBar ? styles.withCustomChrome : '']
        .filter(Boolean)
        .join(' ')}
    >
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar variant="workspace" />
        </div>
      ) : null}

      <div className={styles.popupBody}>
        <ChannelsPage mode="popup" />
      </div>
    </div>
  )
}
