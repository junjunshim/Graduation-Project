import { useState } from 'react'
import { getLegalDocument, type LegalDocumentId } from '../model/legalDocuments'
import { LegalDocumentDialog } from './LegalDocumentDialog'
import styles from './AuthLegalFooter.module.css'

export function AuthLegalFooter() {
  const [openDocumentId, setOpenDocumentId] = useState<LegalDocumentId | null>(null)
  const legalDocument = openDocumentId ? getLegalDocument(openDocumentId) : null

  return (
    <>
      <footer className={styles.footer}>
        <span>© 2026 Axis. All rights reserved.</span>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.link}
          onClick={() => setOpenDocumentId('terms')}
          aria-haspopup="dialog"
        >
          이용약관
        </button>
        <span className={styles.divider} aria-hidden="true" />
        <button
          type="button"
          className={styles.link}
          onClick={() => setOpenDocumentId('privacy')}
          aria-haspopup="dialog"
        >
          개인정보처리방침
        </button>
      </footer>

      <LegalDocumentDialog legalDocument={legalDocument} onClose={() => setOpenDocumentId(null)} />
    </>
  )
}
