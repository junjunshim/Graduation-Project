import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import { ThemeToggle } from '../../design-system/theme/ThemeToggle'
import { hasCustomWindowControls } from './windowControls'
import styles from './WindowTitleBar.module.css'

type AuthWindowTitleBarProps = {
  variant: 'auth'
  contextLabel: string
}

type WorkspaceWindowTitleBarProps = {
  variant: 'workspace'
  contextLabel: string
  pageTitle: string
  actionLabel: string
  actionTo: string
  userName: string
  userEmail: string
}

type WindowTitleBarProps = AuthWindowTitleBarProps | WorkspaceWindowTitleBarProps

export function WindowTitleBar(props: WindowTitleBarProps) {
  const hasWindowControls = hasCustomWindowControls()
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    if (!hasWindowControls || !window.windowControls) {
      return
    }

    let isMounted = true

    void window.windowControls.isMaximized().then((nextState) => {
      if (isMounted) {
        setIsMaximized(nextState)
      }
    })

    const unsubscribe = window.windowControls.onMaximizeChange((nextState) => {
      setIsMaximized(nextState)
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [hasWindowControls])

  if (!hasWindowControls || !window.windowControls) {
    return null
  }

  return (
    <div className={[styles.bar, props.variant === 'workspace' ? styles.workspace : styles.auth].join(' ')}>
      <div className={styles.left}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>GP</span>
          <span className={styles.brandTitle}>Grad Client</span>
        </div>
        <span className={styles.divider} aria-hidden="true" />
        {props.variant === 'workspace' ? (
          <div className={styles.pageCopy}>
            <span className={styles.context}>{props.contextLabel}</span>
            <strong className={styles.pageTitle}>{props.pageTitle}</strong>
          </div>
        ) : (
          <span className={styles.context}>{props.contextLabel}</span>
        )}
      </div>

      <div className={styles.right}>
        {props.variant === 'workspace' ? (
          <div className={styles.workspaceActions}>
            <NavLink to={props.actionTo} className={styles.actionLink}>
              {props.actionLabel}
            </NavLink>

            <div className={styles.userChip} title={props.userEmail}>
              <span className={styles.userName}>{props.userName}</span>
              <span className={styles.userSubtext}>{props.userEmail}</span>
            </div>
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
            onClick={() => window.windowControls?.minimize()}
          >
            <Icon name="minimize" size={14} />
          </button>

          <button
            type="button"
            className={styles.controlButton}
            aria-label={isMaximized ? 'Restore window' : 'Maximize window'}
            title={isMaximized ? 'Restore' : 'Maximize'}
            onClick={() => window.windowControls?.toggleMaximize()}
          >
            <Icon name={isMaximized ? 'restore' : 'maximize'} size={14} />
          </button>

          <button
            type="button"
            className={[styles.controlButton, styles.controlClose].join(' ')}
            aria-label="Close window"
            title="Close"
            onClick={() => window.windowControls?.close()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
