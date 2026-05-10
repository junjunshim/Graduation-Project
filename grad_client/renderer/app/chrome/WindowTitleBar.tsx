import { useEffect, useState } from 'react'
import { Icon } from '../../design-system/primitives/Icon'
import { ThemeToggle } from '../../design-system/theme/ThemeToggle'
import { getWindowControls } from './windowControls'
import styles from './WindowTitleBar.module.css'

type AuthWindowTitleBarProps = {
  variant: 'auth'
  contextLabel: string
}

type WorkspaceWindowTitleBarProps = {
  variant: 'workspace'
}

type WindowTitleBarProps = AuthWindowTitleBarProps | WorkspaceWindowTitleBarProps

export function WindowTitleBar(props: WindowTitleBarProps) {
  const windowControls = getWindowControls()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!windowControls) {
      return
    }

    let isMounted = true

    void windowControls.isMaximized().then((nextState) => {
      if (isMounted) {
        setIsMaximized(nextState)
      }
    })

    const unsubscribe = windowControls.onMaximizeChange((nextState) => {
      setIsMaximized(nextState)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [windowControls])

  if (!windowControls) {
    return null
  }

  return (
    <div className={[styles.bar, props.variant === 'workspace' ? styles.workspace : styles.auth].join(' ')}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>A</span>
          <span className={styles.brandTitle}>Axis</span>
        </div>
        {props.variant === 'auth' && (
          <>
            <span className={styles.divider} aria-hidden="true" />
            <span className={styles.context}>{props.contextLabel}</span>
          </>
        )}
      </div>

      <div className={styles.right}>
        {props.variant === 'workspace' ? (
          <div className={styles.workspaceActions}>
            
          </div>
        ) : null}

        <div className={styles.themeToggle}>
          <ThemeToggle compact />
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.controlButton}
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => windowControls.minimize()}
          >
            <Icon name="minimize" size={14} />
          </button>

          <button
            type="button"
            className={styles.controlButton}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={() => windowControls.toggleMaximize()}
          >
            <Icon name={isMaximized ? 'restore' : 'maximize'} size={14} />
          </button>

          <button
            type="button"
            className={[styles.controlButton, styles.controlClose].join(' ')}
            aria-label="Close window"
            title="Close"
            onClick={() => windowControls.close()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
