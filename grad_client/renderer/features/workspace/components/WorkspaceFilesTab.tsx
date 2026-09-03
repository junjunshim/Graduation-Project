import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { fetchWorkItemFileContent, type FetchFileContentResult } from '../data/fileService'
import { formatWorkspaceDate, formatWorkspaceShortDate } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'
import { getWorkItemTag } from '../model/workItemTags'
import { FileContentViewerModal } from './FileContentViewerModal'
import styles from './WorkspaceFilesTab.module.css'

type WorkspaceFilesTabProps = {
  workItems: WorkItemRecord[]
  files?: WorkItemFileRecord[]
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileExtension(filename: string) {
  const parts = filename.split('.')
  return parts.length > 1 ? parts.pop()?.toUpperCase() ?? 'FILE' : 'FILE'
}

function getFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext ?? '')) {
    return 'page'
  }
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'hwp', 'xlsx', 'pptx'].includes(ext ?? '')) {
    return 'fileText'
  }
  return 'fileText'
}

// 파일이 등록되어 있지 않은 업무를 위한 기본 산출물 파일 데이터 생성
function getMockFilesForWorkItem(item: WorkItemRecord): WorkItemFileRecord[] {
  const tag = getWorkItemTag(item)
  const tagLabel = tag?.label ?? '업무'
  const dateStr = item.createdAt || new Date().toISOString()

  return [
    {
      id: Number(item.workItemId.replace(/\D/g, '') || '1') * 100 + 1,
      workItemId: item.workItemId,
      originalFileName: `[${tagLabel}] ${item.title}_요구사항정의서.md`,
      fileSize: 1024 * 450 + (item.title.length * 1024 * 25),
      mimeType: 'text/markdown',
      uploaderName: '담당자',
      uploaderUserId: item.ownerUserId,
      uploaderEmail: '',
      createdAt: dateStr,
    },
    {
      id: Number(item.workItemId.replace(/\D/g, '') || '1') * 100 + 2,
      workItemId: item.workItemId,
      originalFileName: `${item.title}_산출물_명세서.txt`,
      fileSize: 1024 * 180 + (item.title.length * 1024 * 12),
      mimeType: 'text/plain',
      uploaderName: '담당자',
      uploaderUserId: item.ownerUserId,
      uploaderEmail: '',
      createdAt: dateStr,
    },
  ]
}

function getSampleDocumentContent(fileName: string, itemTitle: string) {
  return `# ${fileName}

## 1. 개요
- **대상 업무**: ${itemTitle}
- **작성일시**: ${new Date().toLocaleDateString('ko-KR')}
- **문서 버전**: v1.0.0
- **상태**: 검토 완료

---

## 2. 주요 요구사항 및 상세 내역
1. **시스템 아키텍처 연동**
   - 계층형 조직 노드 및 업무 객체와 실시간 동기화
   - 파일 다운로드 및 HTTP 304 조건부 캐시 처리 지원
2. **산출물 명세**
   - 사용자 인터페이스: GitHub 스타일 뷰어 (Preview / Raw 토글 지원)
   - 줄 번호(Line Numbers) 및 원시 데이터 복사 기능 내장

---

## 3. 변경 이력 (Changelog)
| 버전 | 변경 내용 | 작성자 | 일자 |
| :--- | :--- | :--- | :--- |
| v1.0.0 | 초안 작성 및 시스템 요구사항 정의 | 담당자 | ${new Date().toLocaleDateString('ko-KR')} |
`
}

export function WorkspaceFilesTab({ workItems, files = [] }: WorkspaceFilesTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => workItems[0]?.workItemId ?? null)
  const [viewLayout, setViewLayout] = useState<'grid' | 'table'>('grid')

  // 파일 뷰어 모달 상태
  const [viewerFile, setViewerFile] = useState<WorkItemFileRecord | null>(null)
  const [fileContentData, setFileContentData] = useState<FetchFileContentResult | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // 각 업무별로 실제 등록된 파일 또는 모의 파일 매핑
  const filesByWorkItem = useMemo(() => {
    const map = new Map<string, WorkItemFileRecord[]>()

    workItems.forEach((item) => {
      const realFiles = files.filter((f) => f.workItemId === item.workItemId && !f.isDeleted)
      if (realFiles.length > 0) {
        map.set(item.workItemId, realFiles)
      } else {
        map.set(item.workItemId, getMockFilesForWorkItem(item))
      }
    })

    return map
  }, [files, workItems])

  // 검색어 필터링 적용된 업무(폴더) 목록
  const filteredFolders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return workItems

    return workItems.filter((item) => {
      const matchTitle = item.title.toLowerCase().includes(query)
      const folderFiles = filesByWorkItem.get(item.workItemId) ?? []
      const matchFile = folderFiles.some((f) => f.originalFileName.toLowerCase().includes(query))
      return matchTitle || matchFile
    })
  }, [filesByWorkItem, searchQuery, workItems])

  // 현재 선택된 폴더 업무 객체
  const selectedWorkItem = useMemo(() => {
    if (!selectedFolderId) return filteredFolders[0] ?? workItems[0] ?? null
    return workItems.find((item) => item.workItemId === selectedFolderId) ?? filteredFolders[0] ?? null
  }, [filteredFolders, selectedFolderId, workItems])

  // 현재 선택된 폴더 내부의 파일 목록
  const activeFiles = useMemo(() => {
    if (!selectedWorkItem) return []
    const folderFiles = filesByWorkItem.get(selectedWorkItem.workItemId) ?? []
    const query = searchQuery.trim().toLowerCase()
    if (!query) return folderFiles

    // 현재 폴더명(업무명) 자체가 검색어와 일치하면 해당 폴더 내의 모든 파일 표시
    const folderTitleMatches = selectedWorkItem.title.toLowerCase().includes(query)
    if (folderTitleMatches) {
      return folderFiles
    }

    // 폴더명이 일치하지 않고 파일명 검색으로 진입한 경우 해당 파일명과 일치하는 파일만 필터링
    return folderFiles.filter((f) => f.originalFileName.toLowerCase().includes(query))
  }, [filesByWorkItem, searchQuery, selectedWorkItem])

  const totalFilesCount = useMemo(() => {
    let total = 0
    filesByWorkItem.forEach((fileList) => {
      total += fileList.length
    })
    return total
  }, [filesByWorkItem])

  const handleOpenFile = async (file: WorkItemFileRecord) => {
    setViewerFile(file)
    setIsLoadingFile(true)
    setFileError(null)

    const fallbackSample = getSampleDocumentContent(
      file.originalFileName,
      selectedWorkItem?.title || '업무',
    )

    try {
      const res = await fetchWorkItemFileContent(file.id, fallbackSample)
      setFileContentData(res)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '파일 내용을 불러오지 못했습니다.')
    } finally {
      setIsLoadingFile(false)
    }
  }

  const handleCloseViewer = () => {
    setViewerFile(null)
    setFileContentData(null)
    setFileError(null)
  }

  return (
    <div className={styles.container}>
      {/* 상단 툴바 */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.breadcrumb}>
            <span className={styles.rootCrumb}>
              <Icon name="folder" size={16} />
              <span>파일 탐색기</span>
            </span>
            {selectedWorkItem ? (
              <>
                <Icon name="chevronRight" size={13} className={styles.crumbArrow} />
                <span className={styles.activeCrumb}>
                  <Icon name="folder" size={15} />
                  <strong>{selectedWorkItem.title}</strong>
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          <SearchField
            label="파일 또는 폴더 검색"
            placeholder="파일 또는 폴더 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            containerClassName={styles.searchBox}
          />

          <div className={styles.viewToggleGroup}>
            <button
              type="button"
              className={[styles.viewToggleBtn, viewLayout === 'grid' ? styles.viewToggleBtnActive : ''].join(' ')}
              onClick={() => setViewLayout('grid')}
              title="격자 보기"
              aria-label="격자 보기"
            >
              <Icon name="cube" size={16} />
            </button>
            <button
              type="button"
              className={[styles.viewToggleBtn, viewLayout === 'table' ? styles.viewToggleBtnActive : ''].join(' ')}
              onClick={() => setViewLayout('table')}
              title="목록 보기"
              aria-label="목록 보기"
            >
              <Icon name="list" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* 메인 2열 탐색기 레이아웃 */}
      <div className={styles.explorerGrid}>
        {/* 좌측 폴더(업무) 트리 네비게이션 */}
        <aside className={styles.folderSidebar} aria-label="업무 폴더 목록">
          <div className={styles.sidebarHeader}>
            <span>업무 폴더 ({filteredFolders.length})</span>
            <span className={styles.sidebarTotalFiles}>전체 {totalFilesCount}개 파일</span>
          </div>

          <div className={styles.folderList}>
            {filteredFolders.length === 0 ? (
              <div className={styles.emptyFolderList}>검색된 폴더가 없습니다.</div>
            ) : (
              filteredFolders.map((item) => {
                const isSelected = selectedWorkItem?.workItemId === item.workItemId
                const folderFiles = filesByWorkItem.get(item.workItemId) ?? []
                const tag = getWorkItemTag(item)

                return (
                  <button
                    key={item.workItemId}
                    type="button"
                    className={[styles.folderItem, isSelected ? styles.folderItemActive : ''].join(' ')}
                    onClick={() => setSelectedFolderId(item.workItemId)}
                  >
                    <span className={styles.folderIcon}>
                      <Icon name="folder" size={17} />
                    </span>
                    <div className={styles.folderInfo}>
                      <span className={styles.folderName} title={item.title}>
                        {item.title}
                      </span>
                      <span className={styles.folderMeta}>
                        {tag ? <span className={styles.tagBadge}>{tag.label}</span> : null}
                        <span>{folderFiles.length}개 파일</span>
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>

        {/* 우측 선택된 폴더 내부 파일 목록 */}
        <main className={styles.filesViewport} aria-label="파일 목록">
          {selectedWorkItem ? (
            <div className={styles.folderDetailHeader}>
              <div className={styles.folderDetailTitle}>
                <Icon name="folder" size={20} className={styles.folderHeaderIcon} />
                <div>
                  <div className={styles.folderDetailHeading}>
                    <h2>{selectedWorkItem.title}</h2>
                    <span
                      className={styles.statusPill}
                      data-tone={getWorkItemStatusTone(selectedWorkItem.status)}
                    >
                      {getWorkItemStatusLabel(selectedWorkItem.status)}
                    </span>
                  </div>
                  <p className={styles.folderDetailSub}>
                    마감일: {selectedWorkItem.dueDate ? formatWorkspaceShortDate(selectedWorkItem.dueDate) : '미정'} · 총 {activeFiles.length}개 파일
                  </p>
                </div>
              </div>

              <Link to={`/work-items/${selectedWorkItem.workItemId}`} className={styles.openTaskLink}>
                <span>업무 상세 보기</span>
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          ) : null}

          {/* 파일 리스트 영역 */}
          <div className={styles.filesContent}>
            {activeFiles.length === 0 ? (
              <div className={styles.emptyFilesState}>
                <Icon name="page" size={32} />
                <p>이 폴더에 등록된 파일이 없습니다.</p>
              </div>
            ) : viewLayout === 'grid' ? (
              <div className={styles.fileGrid}>
                {activeFiles.map((file) => {
                  const ext = getFileExtension(file.originalFileName)
                  const iconName = getFileIcon(file.originalFileName)

                  return (
                    <div
                      key={file.id}
                      className={styles.fileCard}
                      onClick={() => handleOpenFile(file)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleOpenFile(file)
                        }
                      }}
                    >
                      <div className={styles.fileCardPreview}>
                        <Icon name={iconName} size={30} className={styles.filePreviewIcon} />
                        <span className={styles.fileBadge}>{ext}</span>
                      </div>
                      <div className={styles.fileCardBody}>
                        <strong className={styles.fileName} title={file.originalFileName}>
                          {file.originalFileName}
                        </strong>
                        <div className={styles.fileMetaRow}>
                          <span>{formatFileSize(file.fileSize)}</span>
                          <span>{formatWorkspaceShortDate(file.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.fileTableContainer}>
                <table className={styles.fileTable}>
                  <thead>
                    <tr>
                      <th className={styles.thName}>파일명</th>
                      <th className={styles.thSize}>크기</th>
                      <th className={styles.thDate}>등록일</th>
                      <th className={styles.thUploader}>등록자</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeFiles.map((file) => {
                      const iconName = getFileIcon(file.originalFileName)

                      return (
                        <tr
                          key={file.id}
                          className={styles.fileTableRow}
                          onClick={() => handleOpenFile(file)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td className={styles.tdName}>
                            <Icon name={iconName} size={16} className={styles.tableFileIcon} />
                            <span className={styles.tableFileName} title={file.originalFileName}>
                              {file.originalFileName}
                            </span>
                          </td>
                          <td className={styles.tdSize}>{formatFileSize(file.fileSize)}</td>
                          <td className={styles.tdDate}>{formatWorkspaceDate(file.createdAt)}</td>
                          <td className={styles.tdUploader}>{file.uploaderName || '담당자'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* GitHub 스타일 파일 뷰어 모달 */}
      {viewerFile ? (
        <FileContentViewerModal
          isOpen={Boolean(viewerFile)}
          onClose={handleCloseViewer}
          fileName={viewerFile.originalFileName}
          content={fileContentData?.content ?? ''}
          fileSize={viewerFile.fileSize}
          lastModified={fileContentData?.lastModified || viewerFile.createdAt}
          fromCache={fileContentData?.fromCache}
          isLoading={isLoadingFile}
          error={fileError}
          sourceLabel={`업무: ${selectedWorkItem?.title || ''}`}
        />
      ) : null}
    </div>
  )
}
