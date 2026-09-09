import { useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import menuStyles from './FileContextMenu.module.css'
import { showToast } from '../../notification/data/toastEvents'
import { uploadWorkItemFile } from '../data/fileService'
import { fetchWorkItemDetail } from '../data/workItemService'
import styles from './WorkItemFileUpload.module.css'

type Props = {
  workItemId: string
  workItemTitle: string
  onUploaded?: () => Promise<void>
}

export function WorkItemFileUpload({ workItemId, workItemTitle, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMessage('')
    setFailed(false)
    let uploaded = false
    try {
      await uploadWorkItemFile(workItemId, file)
      uploaded = true
      showToast({
        title: '파일 등록 완료',
        content: `‘${workItemTitle}’ 업무에 ‘${file.name}’ 파일이 등록되었습니다.`,
        link_url: `/work-items/${encodeURIComponent(workItemId)}`,
        created_at: new Date().toISOString(),
      })
      if (onUploaded) await onUploaded()
      else await fetchWorkItemDetail(workItemId)
    } catch (error) {
      setFailed(true)
      setMessage(uploaded
        ? '파일은 등록되었지만 목록을 갱신하지 못했습니다. 페이지를 새로고침해 주세요.'
        : error instanceof Error ? error.message : '파일을 등록하지 못했습니다.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className={styles.upload}>
      <input ref={inputRef} type="file" hidden onChange={handleFileChange} disabled={busy} aria-label="등록할 파일 선택" />
      <button type="button" role="menuitem" className={menuStyles.item} disabled={busy} onClick={() => inputRef.current?.click()}>
        <Icon name="plus" size={15} />
        <span>{busy ? '등록 중…' : '파일 등록'}</span>
      </button>
      {message ? <p className={styles.message} role={failed ? 'alert' : 'status'}>{message}</p> : null}
    </div>
  )
}
