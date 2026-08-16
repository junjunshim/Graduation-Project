// 각 페이지의 상단 액션(알림, 프로필 등) 관리
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import styles from './ShellTopActions.module.css'

export type ShellTopActionsHeading =
  | {
      type: 'greeting'
    }
  | {
      type: 'breadcrumb'
      label: string
      title: string
      subtitle: string
    }
  | {
      type: 'page'
      title: string
      subtitle: string
    }
  | {
      type: 'workItem'
      title: string
      subtitle: string
      backTo: string
      category?: {
        label: string
        tone: string
      }
      status: {
        label: string
        tone: string
      }
    }
  | {
      type: 'none'
    }

type ShellTopActionsProps = {
  currentUser: {
    name: string
    userId: string
  }
  heading: ShellTopActionsHeading
  inset?: 'standard' | 'wide'
}

export function ShellTopActions({
  currentUser,
  heading,
  inset = 'standard',
}: ShellTopActionsProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const shellTopActionsClassName = [
    styles.shellTopActions,
    inset === 'wide' ? styles.shellTopActionsWide : styles.shellTopActionsStandard,
  ].join(' ')

  return (
    <header className={shellTopActionsClassName}>
      {heading.type === 'breadcrumb' ? (
        <div className={styles.shellHeading}>
          <p className={styles.shellBreadcrumb}>
            <span>{heading.label}</span>
            <Icon name="chevronRight" size={14} />
            <strong>{heading.title}</strong>
          </p>
          <p className={styles.shellSubtitle}>{heading.subtitle}</p>
        </div>
      ) : heading.type === 'page' ? (
        <div className={styles.shellHeading}>
          <h1 className={styles.shellPageTitle}>{heading.title}</h1>
          <p className={styles.shellSubtitle}>{heading.subtitle}</p>
        </div>
      ) : heading.type === 'workItem' ? (
        <div className={styles.workItemHeading}>
          <Link to={heading.backTo} className={styles.workItemBackLink}>
            <Icon name="chevronLeft" size={15} />
            업무 목록
          </Link>
          <div className={styles.workItemTitleLine}>
            <h1 className={styles.workItemTitle}>{heading.title}</h1>
            {heading.category ? (
              <span className={styles.workItemCategory} data-tone={heading.category.tone}>
                · {heading.category.label}
              </span>
            ) : null}
            <span className={styles.workItemStatus} data-tone={heading.status.tone}>
              {heading.status.label}
            </span>
          </div>
          <p className={styles.shellSubtitle}>{heading.subtitle}</p>
        </div>
      ) : heading.type === 'greeting' ? (
        <p className={styles.shellGreeting}>
          안녕하세요.
        </p>
      ) : null}

      {heading.type !== 'workItem' ? (
        <div className={styles.shellTopActionControls}>
          <label className={styles.shellSearchBox}>
            <span className={styles.shellSearchIcon}>
              <Icon name="search" size={20} />
            </span>
            <span className={styles.srOnly}>Search</span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search"
            />
          </label>

          <div className={styles.shellActionButtons}>
            <button type="button" className={styles.shellIconButton} aria-label="Notifications">
              <Icon name="bell" size={20} />
            </button>

            <button
              type="button"
              className={styles.shellProfileButton}
              aria-label="User menu"
              title={`${currentUser.name} (${currentUser.userId})`}
            >
              <Icon name="user" size={20} />
            </button>
          </div>
        </div>
      ) : null}
    </header>
  )
}
