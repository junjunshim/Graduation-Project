import { useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './FileContextMenu.module.css'
import { showToast } from '../../notification/data/toastEvents'
import { downloadWorkItemFile } from '../data/fileService'
import type { WorkItemFileRecord } from '../model/types'

export function WorkItemFileDownload({
  file,
  onComplete,
  disabled = false,
  disabledReason,
}: {
  file: WorkItemFileRecord
  onComplete?: () => void
  /** 권한이 없으면 메뉴 항목을 비활성화한다 (기본: 허용) */
  disabled?: boolean
  disabledReason?: string
}) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)

  async function handleDownload() {
    if (busyRef.current || disabled) return
    busyRef.current = true
    setBusy(true)
    try {
      await downloadWorkItemFile(file.id, file.originalFileName)
      showToast({
        title: '파일 다운로드 완료',
        content: `'${file.originalFileName}' 파일을 다운로드했습니다.`,
        link_url: `/work-items/${encodeURIComponent(file.workItemId)}`,
        created_at: new Date().toISOString(),
      })
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
      className={[styles.item, disabled ? styles.permissionDenied : ''].join(' ')}
      role="menuitem"
      disabled={busy || disabled}
      title={disabled ? disabledReason : undefined}
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
