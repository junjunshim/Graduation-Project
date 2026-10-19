import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './ChatMessageComposer.module.css'

export type ChatMessageComposerProps = {
  placeholder: string
  canChat: boolean
  readOnlyMessage?: string
  disabled?: boolean
  compact?: boolean
  onSend: (content: string, files: File[]) => Promise<void> | void
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ChatMessageComposer({
  placeholder,
  canChat,
  readOnlyMessage = '이 채널에 메시지를 작성할 권한이 없습니다.',
  disabled = false,
  compact = false,
  onSend,
}: ChatMessageComposerProps) {
  const [content, setContent] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [isSending, setIsSending] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (!canChat) {
    return (
      <div className={styles.readOnlyBanner} role="status">
        <Icon name="lock" size={15} />
        <span>{readOnlyMessage}</span>
      </div>
    )
  }

  const canSubmit = !disabled && !isSending && (content.trim().length > 0 || files.length > 0)

  async function handleSubmit() {
    if (!canSubmit) return

    const trimmed = content.trim()
    const attached = [...files]

    setIsSending(true)
    try {
      await onSend(trimmed, attached)
      setContent('')
      setFiles([])
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    } finally {
      setIsSending(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) {
        return
      }
      event.preventDefault()
      void handleSubmit()
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files ? Array.from(event.target.files) : []
    if (selected.length > 0) {
      setFiles((prev) => [...prev, ...selected])
    }
    event.target.value = ''
  }

  function handleRemoveFile(index: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== index))
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!disabled && !isSending) {
      setIsDraggingOver(true)
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingOver(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDraggingOver(false)
    if (disabled || isSending) return

    const dropped = event.dataTransfer.files ? Array.from(event.dataTransfer.files) : []
    if (dropped.length > 0) {
      setFiles((prev) => [...prev, ...dropped])
    }
  }

  return (
    <div
      className={styles.composer}
      data-compact={compact ? 'true' : undefined}
      data-dragging={isDraggingOver ? 'true' : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {files.length > 0 ? (
        <div className={styles.fileChipList} aria-label="첨부 대기 파일">
          {files.map((file, idx) => (
            <div key={`${file.name}-${idx}`} className={styles.fileChip}>
              <Icon name="fileText" size={14} />
              <span className={styles.fileChipName} title={file.name}>
                {file.name}
              </span>
              <span className={styles.fileChipSize}>({formatFileSize(file.size)})</span>
              <button
                type="button"
                className={styles.fileChipRemove}
                aria-label={`${file.name} 첨부 취소`}
                onClick={() => handleRemoveFile(idx)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.inputRow}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className={styles.hiddenFileInput}
          onChange={handleFileChange}
        />

        <button
          type="button"
          className={styles.attachButton}
          title="파일 또는 이미지 첨부"
          aria-label="파일 또는 이미지 첨부"
          disabled={disabled || isSending}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon name="plus" size={17} />
        </button>

        <textarea
          ref={textareaRef}
          rows={1}
          value={content}
          placeholder={placeholder}
          disabled={disabled || isSending}
          className={styles.textarea}
          onChange={(event) => {
            setContent(event.target.value)
            const el = event.target
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 140)}px`
          }}
          onKeyDown={handleKeyDown}
        />

        <button
          type="button"
          className={styles.sendButton}
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
        >
          <span>{isSending ? '전송 중' : '전송'}</span>
          <Icon name="arrowRight" size={15} />
        </button>
      </div>
    </div>
  )
}
