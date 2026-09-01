import styles from './DocumentIcon.module.css'

export type DocumentKind = 'document' | 'presentation' | 'spreadsheet'

export type DocumentIconProps = {
  kind?: DocumentKind
  size?: number
}

export function DocumentIcon({ kind = 'document', size }: DocumentIconProps) {
  return (
    <span
      className={styles.icon}
      data-kind={kind}
      style={size === undefined ? undefined : { width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          fill="currentColor"
          d="M6.5 2.5h7.1l4.9 4.9v13.1a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-17a1 1 0 0 1 1-1Z"
        />
        <path d="M13.5 2.9v4.9h4.9" />
        <path d="M8.5 11h7M8.5 14h7M8.5 17h5" />
      </svg>
    </span>
  )
}
