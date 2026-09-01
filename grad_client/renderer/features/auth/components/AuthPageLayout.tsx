import type { ReactNode } from 'react'
import { WindowTitleBar } from '../../../app/chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../../../app/chrome/windowControls'
import { useBodyScrollSurface } from '../../../app/chrome/useBodyScrollSurface'
import { AxisMark } from '../../../design-system/primitives/AxisMark'
import { ThemeToggle } from '../../../design-system/theme/ThemeToggle'
import styles from './AuthPageLayout.module.css'

type AuthStep = {
  number: string
  title: string
  description: string
}

type AuthPageLayoutProps = {
  heroEyebrow: string
  heroTitle: string
  heroDescription: string
  steps: AuthStep[]
  formEyebrow: string
  formTitle: string
  formText?: ReactNode
  formContent: ReactNode
  supportEyebrow: string
  supportTitle: string
  supportText: string
  supportContent?: ReactNode
}

export function AuthPageLayout({
  heroEyebrow,
  heroTitle,
  heroDescription,
  steps,
  formEyebrow,
  formTitle,
  formText,
  formContent,
  supportEyebrow,
  supportTitle,
  supportText,
  supportContent,
}: AuthPageLayoutProps) {
  const hasCustomTitleBar = hasCustomWindowControls()

  useBodyScrollSurface(hasCustomTitleBar ? 'auth' : undefined)

  return (
    <main className={[styles.page, hasCustomTitleBar ? styles.pageWithCustomChrome : ''].filter(Boolean).join(' ')}>
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar variant="auth" />
        </div>
      ) : null}
      <div className={styles.pageInner}>
        <header className={styles.topBar}>
          <div className={styles.brandBlock}>
            <AxisMark size={30} className={styles.brandMark} />
            <div className={styles.brandCopy}>
              <strong>Axis</strong>
              <span>협업 워크스페이스</span>
            </div>
          </div>
          {!hasCustomTitleBar ? <ThemeToggle /> : null}
        </header>

        <section className={styles.frame}>
          <section className={styles.storyPanel}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>{heroEyebrow}</p>
              <h1 className={styles.title}>{heroTitle}</h1>
              <p className={styles.description}>{heroDescription}</p>
            </div>

            <div className={styles.stepRail}>
              {steps.map((step) => (
                <article key={step.number} className={styles.stepCard}>
                  <span className={styles.stepNumber}>{step.number}</span>
                  <div className={styles.stepCopy}>
                    <strong>{step.title}</strong>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.formShell}>
            <div className={styles.formColumn}>
              <div className={styles.formHeader}>
                <p className={styles.formEyebrow}>{formEyebrow}</p>
                <h2 className={styles.formTitle}>{formTitle}</h2>
                {formText ? <div className={styles.formText}>{formText}</div> : null}
              </div>

              {formContent}
            </div>

            <aside className={styles.supportColumn}>
              <p className={styles.formEyebrow}>{supportEyebrow}</p>
              <h2 className={styles.supportTitle}>{supportTitle}</h2>
              <p className={styles.supportText}>{supportText}</p>
              {supportContent}
            </aside>
          </section>
        </section>
      </div>
    </main>
  )
}
