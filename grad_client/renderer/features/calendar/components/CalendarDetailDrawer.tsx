import { useEffect, type AnimationEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import type { CalendarChipTone } from '../model/calendarTypes'
import styles from './CalendarDetailDrawer.module.css'

/** 상세 드로어의 정보 한 줄 (아이콘 + 라벨 + 값) */
export type CalendarDetailRow = {
  key: string
  icon: IconName
  label: string
  value: ReactNode
}

export type CalendarDetailAction = {
  key: string
  label: string
  icon: IconName
  tone?: 'default' | 'danger'
  onClick: () => void
}

export type CalendarDetailAttachment = {
  id: string
  name: string
  sizeLabel: string | null
}

export type CalendarDetailDrawerProps = {
  isOpen: boolean
  badgeLabel: string
  badgeTone: CalendarChipTone
  title: string
  rows: CalendarDetailRow[]
  description: string | null
  attachments: CalendarDetailAttachment[]
  attachmentsTitle?: string
  actions?: CalendarDetailAction[]
  createdAt: string | null
  updatedAt: string | null
  /** true 면 오버레이 대신 페이지 레이아웃 안에 도킹해 그린다. */
  docked?: boolean
  /** true 면 퇴장 애니메이션을 재생한 뒤 onExited 를 호출한다. */
  closing?: boolean
  onExited?: () => void
  onClose: () => void
}

const EMPTY_DESCRIPTION = '설명이 없습니다.'
const EMPTY_ATTACHMENTS = '첨부된 파일이 없습니다.'

/**
 * 캘린더 우측 상세 드로어.
 * 업무(시작/마감/진행 중)와 정기 일정이 같은 레이아웃을 공유한다.
 */
export function CalendarDetailDrawer({
  isOpen,
  badgeLabel,
  badgeTone,
  title,
  rows,
  description,
  attachments,
  attachmentsTitle = '첨부파일',
  actions = [],
  createdAt,
  updatedAt,
  docked = false,
  closing = false,
  onExited,
  onClose,
}: CalendarDetailDrawerProps) {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !closing) return
    onExited?.()
  }

  if (!isOpen || (!docked && typeof document === 'undefined')) return null

  const panelClassName = [styles.drawer, docked ? styles.drawerDocked : ''].filter(Boolean).join(' ')

  // 도킹 모드에서는 오버레이 없이 페이지 레이아웃 안에 그린다(달력을 가리지 않는다).
  const panel = (
      <aside
        className={panelClassName}
        role="dialog"
        aria-modal={docked ? undefined : true}
        aria-label={title}
        data-closing={closing ? 'true' : undefined}
        onAnimationEnd={handleAnimationEnd}
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <span className={styles.badge} data-tone={badgeTone}>
              {badgeLabel}
            </span>
            <h2 className={styles.title}>{title}</h2>
          </div>

          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        </header>

        {actions.length > 0 ? (
          <div className={styles.actions}>
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={styles.actionButton}
                data-tone={action.tone ?? 'default'}
                onClick={action.onClick}
              >
                <Icon name={action.icon} size={15} />
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.body}>
          <dl className={styles.metaList}>
            {rows.map((row) => (
              <div className={styles.metaRow} key={row.key}>
                <dt className={styles.metaLabel}>
                  <Icon name={row.icon} size={15} className={styles.metaIcon} />
                  {row.label}
                </dt>
                <dd className={styles.metaValue}>{row.value}</dd>
              </div>
            ))}
          </dl>

          <div className={styles.divider} />

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>설명</h3>
            <p className={styles.description}>{description?.trim() ? description : EMPTY_DESCRIPTION}</p>
          </section>

          <div className={styles.divider} />

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              {attachmentsTitle} ({attachments.length})
            </h3>

            {attachments.length > 0 ? (
              <ul className={styles.fileList}>
                {attachments.map((file) => (
                  <li className={styles.fileRow} key={file.id}>
                    <Icon name="fileText" size={15} className={styles.fileIcon} />
                    <span className={styles.fileName} title={file.name}>
                      {file.name}
                    </span>
                    {file.sizeLabel ? <span className={styles.fileSize}>{file.sizeLabel}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.emptyText}>{EMPTY_ATTACHMENTS}</p>
            )}
          </section>

          <div className={styles.divider} />

          <dl className={styles.metaList}>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabelPlain}>생성일</dt>
              <dd className={styles.metaValue}>{createdAt ?? '-'}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt className={styles.metaLabelPlain}>최근 수정일</dt>
              <dd className={styles.metaValue}>{updatedAt ?? '-'}</dd>
            </div>
          </dl>
        </div>
      </aside>
  )

  if (docked) return panel

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      {panel}
    </div>,
    document.body,
  )
}
