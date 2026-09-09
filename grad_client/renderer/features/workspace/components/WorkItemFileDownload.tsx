import { useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './FileContextMenu.module.css'
import { showToast } from '../../notification/data/toastEvents'
import { downloadWorkItemFile } from '../data/fileService'
import type { WorkItemFileRecord } from '../model/types'

export function WorkItemFileDownload({ file, onComplete }: { file: WorkItemFileRecord; onComplete?: () => void }) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  async function handleDownload() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await downloadWorkItemFile(file.id, file.originalFileName)
    } catch (error) {
      showToast({
        title: '파일 다운로드 실패',
        content: `${file.originalFileName}: ${error instanceof Error ? error.message : '파일을 다운로드하지 못했습니다.'}`,
        link_url: `/work-items/${encodeURIComponent(file.workItemId)}`,
        created_at: new Date().toISOString(),
      })
    } finally {
      busyRef.current = false
      setBusy(false)
      onComplete?.()
    }
  }

  return (
    <button
      type="button"
      className={styles.item}
      role="menuitem"
      disabled={busy}
      aria-label={`${file.originalFileName} 다운로드`}
      onClick={(event) => {
        event.stopPropagation()
        void handleDownload()
      }}
    >
      <Icon name="chevronDown" size={15} />
      <span>{busy ? '다운로드 중…' : '다운로드'}</span>
    </button>
  )
}
