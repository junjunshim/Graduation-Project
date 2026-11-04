import { useEffect, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { downloadChatFile, fetchChatFileBlobUrl } from '../api/channelApi'
import type { ChatMessageFile } from '../model/channelTypes'
import styles from './ChatFileAttachments.module.css'

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

function isImageFile(file: ChatMessageFile): boolean {
  if (file.mimeType && file.mimeType.toLowerCase().startsWith('image/')) {
    return true
  }
  return IMAGE_EXTENSIONS.test(file.originalFileName)
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ImageAttachmentCard({ file }: { file: ChatMessageFile }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    let active = true
    setHasError(false)

    fetchChatFileBlobUrl(file.fileId)
      .then((url) => {
        if (active) {
          setBlobUrl(url)
        }
      })
      .catch(() => {
        if (active) {
          setHasError(true)
        }
      })

    return () => {
      active = false
    }
  }, [file.fileId])

  async function handleDownload() {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      await downloadChatFile(file.fileId, file.originalFileName)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className={styles.imageCard}>
      {blobUrl && !hasError ? (
        <button
          type="button"
          className={styles.imagePreviewButton}
          onClick={() => void handleDownload()}
          title={`${file.originalFileName} 다운로드`}
        >
          <img
            src={blobUrl}
            alt={file.originalFileName}
            className={styles.imagePreview}
            onError={() => setHasError(true)}
          />
        </button>
      ) : (
        <div className={styles.imagePlaceholder}>
          <Icon name="page" size={18} />
          <span>{hasError ? '이미지를 미리볼 수 없습니다.' : '이미지 불러오는 중...'}</span>
        </div>
      )}

      <div className={styles.imageFooter}>
        <div className={styles.fileMeta}>
          <span className={styles.fileName} title={file.originalFileName}>
            {file.originalFileName}
          </span>
          <span className={styles.fileSize}>{formatFileSize(file.fileSize)}</span>
        </div>

        <button
          type="button"
          className={styles.downloadButton}
          disabled={isDownloading}
          onClick={() => void handleDownload()}
        >
          <span>{isDownloading ? '저장 중...' : '다운로드'}</span>
        </button>
      </div>
    </div>
  )
}

function FileAttachmentCard({ file }: { file: ChatMessageFile }) {
  const [isDownloading, setIsDownloading] = useState(false)

  async function handleDownload() {
    if (isDownloading) return
    setIsDownloading(true)
    try {
      await downloadChatFile(file.fileId, file.originalFileName)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className={styles.fileCard}>
      <span className={styles.fileIconBox} aria-hidden="true">
        <Icon name="fileText" size={16} />
      </span>

      <div className={styles.fileMeta}>
        <span className={styles.fileName} title={file.originalFileName}>
          {file.originalFileName}
        </span>
        <span className={styles.fileSize}>{formatFileSize(file.fileSize)}</span>
      </div>

      <button
        type="button"
        className={styles.downloadButton}
        disabled={isDownloading}
        onClick={() => void handleDownload()}
      >
        <span>{isDownloading ? '저장 중...' : '다운로드'}</span>
      </button>
    </div>
  )
}

export function ChatFileAttachments({ files }: { files: ChatMessageFile[] }) {
  if (!files || files.length === 0) {
    return null
  }

  return (
    <div className={styles.attachmentList}>
      {files.map((file) =>
        isImageFile(file) ? (
          <ImageAttachmentCard key={file.fileId} file={file} />
        ) : (
          <FileAttachmentCard key={file.fileId} file={file} />
        ),
      )}
    </div>
  )
}
