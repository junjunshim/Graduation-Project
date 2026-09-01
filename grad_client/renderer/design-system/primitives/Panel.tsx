import {
  forwardRef,
  type HTMLAttributes,
} from 'react'
import styles from './Panel.module.css'

export type PanelVariant = 'surface' | 'popover' | 'dialog'

export type PanelProps = HTMLAttributes<HTMLDivElement> & {
  variant?: PanelVariant
}

const variantClassNames: Record<PanelVariant, string> = {
  surface: styles.surface,
  popover: styles.popover,
  dialog: styles.dialog,
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  {
    className,
    variant = 'surface',
    ...props
  },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[styles.panel, variantClassNames[variant], className].filter(Boolean).join(' ')}
      {...props}
    />
  )
})
