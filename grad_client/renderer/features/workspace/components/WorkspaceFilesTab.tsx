import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { fetchWorkItemFileContent, type FetchFileContentResult } from '../data/fileService'
import {
  fetchRecurringRules,
  fetchRecurringRuleFileContent,
} from '../data/recurringRuleService'
import { isPreviewableFile } from '../model/filePreview'
import { formatWorkspaceDate, formatWorkspaceShortDate } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { RecurringRuleRecord } from '../model/recurringRuleTypes'
import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'
import { getWorkItemTag } from '../model/workItemTags'
import { FileContentViewerModal } from './FileContentViewerModal'
import {
  useFileContextMenu,
  type UnifiedFileRecord,
  type UnifiedFolderTarget,
} from './useFileContextMenu'
import { useWorkItemContextMenu } from './useWorkItemContextMenu'
import { subscribeToRecurringCache } from '../data/workspaceCacheEvents'
import styles from './WorkspaceFilesTab.module.css'

type WorkspaceFilesTabProps = {
  nodeId?: number
  workItems: WorkItemRecord[]
  files?: WorkItemFileRecord[]
  recurringRules?: RecurringRuleRecord[]
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

export function WorkspaceFilesTab({
  nodeId,
  workItems,
  files = [],
  recurringRules: initialRecurringRules,
}: WorkspaceFilesTabProps) {
  const folderSidebarRef = useRef<HTMLElement>(null)
  const folderListRef = useRef<HTMLDivElement>(null)
  const filesContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const content = filesContentRef.current
    if (!content) return

    function handleFilesWheel(event: WheelEvent) {
      if (!content || event.ctrlKey || event.shiftKey || event.deltaY === 0) return
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? content.clientHeight : 1
      event.preventDefault()
      event.stopPropagation()
      content.scrollTop += event.deltaY * unit
    }

    content.addEventListener('wheel', handleFilesWheel, { passive: false })
    return () => content.removeEventListener('wheel', handleFilesWheel)
  }, [])

  useEffect(() => {
    const sidebar = folderSidebarRef.current
    if (!sidebar) return

    function handleFolderWheel(event: WheelEvent) {
      const list = folderListRef.current
      if (!list || event.ctrlKey || event.deltaY === 0) return

      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? list.clientHeight : 1
      event.preventDefault()
      event.stopPropagation()
      list.scrollTop += event.deltaY * unit
    }

    sidebar.addEventListener('wheel', handleFolderWheel, { passive: false })
    return () => sidebar.removeEventListener('wheel', handleFolderWheel)
  }, [])

  const { openFileContextMenu, openUploadContextMenu, fileContextMenu } = useFileContextMenu()
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()

  // 모드: 업무 폴더('tasks') vs 일정 폴더('schedules')
  const [folderMode, setFolderMode] = useState<'tasks' | 'schedules'>('tasks')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(() => workItems[0]?.workItemId ?? null)
  const [viewLayout, setViewLayout] = useState<'grid' | 'table'>('grid')
  const [showDeletedFiles, setShowDeletedFiles] = useState(false)

  // 일정 목록 로컬 상태 (props가 없을 경우 fetch fallback)
  const [loadedRules, setLoadedRules] = useState<RecurringRuleRecord[]>(initialRecurringRules || [])

  const reloadRules = async () => {
    if (nodeId) {
      try {
        const rules = await fetchRecurringRules(nodeId, true)
        setLoadedRules(rules)
      } catch {
        // ignore
      }
    }
  }

  useEffect(() => {
    // 항상 includeDeleted=true로 최신 일정 및 삭제 파일까지 동기화
    if (nodeId) {
      void reloadRules()
    } else if (initialRecurringRules && initialRecurringRules.length > 0) {
      setLoadedRules(initialRecurringRules)
    }

    const unsubCache = subscribeToRecurringCache((evt) => {
      if (!evt.nodeId || evt.nodeId === nodeId) {
        void reloadRules()
      }
    })

    return () => {
      unsubCache()
    }
  }, [nodeId])

  // 파일 뷰어 모달 상태
  const [viewerFile, setViewerFile] = useState<UnifiedFileRecord | null>(null)
  const [fileContentData, setFileContentData] = useState<FetchFileContentResult | null>(null)
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // 1. 업무 파일 변환
  const unifiedWorkItemFiles = useMemo<UnifiedFileRecord[]>(() => {
    return files.map((f) => ({
      ...f,
      fileType: 'work_item' as const,
    }))
  }, [files])

  // 2. 일정 파일 변환
  const unifiedScheduleFiles = useMemo<UnifiedFileRecord[]>(() => {
    const list: UnifiedFileRecord[] = []
    loadedRules.forEach((rule) => {
      (rule.files || []).forEach((f) => {
        list.push({
          ...f,
          id: f.fileId,
          fileType: 'recurring_rule' as const,
          uploaderName: f.uploaderUserId,
        })
      })
    })
    return list
  }, [loadedRules])

  // 3. 전체 휴지통 파일 개수 (업무 파일 삭제본 + 일정 파일 삭제본)
  const deletedWorkItemFiles = useMemo(() => unifiedWorkItemFiles.filter((f) => f.isDeleted), [unifiedWorkItemFiles])
  const deletedScheduleFiles = useMemo(() => unifiedScheduleFiles.filter((f) => f.isDeleted), [unifiedScheduleFiles])
  const totalDeletedFilesCount = deletedWorkItemFiles.length + deletedScheduleFiles.length

  const prevDeletedCountRef = useRef(totalDeletedFilesCount)
  useEffect(() => {
    if (showDeletedFiles && prevDeletedCountRef.current > 0 && totalDeletedFilesCount === 0) {
      setShowDeletedFiles(false)
    }
    prevDeletedCountRef.current = totalDeletedFilesCount
  }, [showDeletedFiles, totalDeletedFilesCount])

  // 모드 변경 또는 휴지통 토글 시 선택된 폴더 초기화
  useEffect(() => {
    if (folderMode === 'tasks') {
      setSelectedFolderId(workItems[0]?.workItemId ?? null)
    } else {
      setSelectedFolderId(null)
    }
  }, [folderMode, showDeletedFiles])

  // --- 업무 폴더 매핑 ---
  const filesByWorkItem = useMemo(() => {
    const map = new Map<string, UnifiedFileRecord[]>()
    workItems.forEach((item) => {
      const targetFiles = unifiedWorkItemFiles.filter((f) => {
        if (f.workItemId !== item.workItemId) return false
        return showDeletedFiles ? Boolean(f.isDeleted) : !f.isDeleted
      })
      map.set(item.workItemId, targetFiles)
    })
    return map
  }, [unifiedWorkItemFiles, showDeletedFiles, workItems])

  const filteredWorkFolders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return workItems.filter((item) => {
      const folderFiles = filesByWorkItem.get(item.workItemId) ?? []
      if (showDeletedFiles && folderFiles.length === 0) {
        return false
      }
      if (!query) return true
      const matchTitle = item.title.toLowerCase().includes(query)
      const matchFile = folderFiles.some((f) => f.originalFileName.toLowerCase().includes(query))
      return matchTitle || matchFile
    })
  }, [filesByWorkItem, searchQuery, showDeletedFiles, workItems])

  // --- 일정 폴더 매핑 ---
  const filesByRule = useMemo(() => {
    const map = new Map<number, UnifiedFileRecord[]>()
    loadedRules.forEach((rule) => {
      const targetFiles = (rule.files || [])
        .filter((f) => (showDeletedFiles ? Boolean(f.isDeleted) : !f.isDeleted))
        .map((f) => ({
          ...f,
          id: f.fileId,
          fileType: 'recurring_rule' as const,
          uploaderName: f.uploaderUserId,
        }))
      map.set(rule.ruleId, targetFiles)
    })
    return map
  }, [loadedRules, showDeletedFiles])

  const activeRulesList = useMemo(() => {
    return loadedRules.filter((r) => showDeletedFiles ? true : (r.isActive && !r.isDeleted))
  }, [loadedRules, showDeletedFiles])

  const filteredScheduleFolders = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return activeRulesList.filter((rule) => {
      const folderFiles = filesByRule.get(rule.ruleId) ?? []
      if (showDeletedFiles && folderFiles.length === 0) {
        return false
      }
      if (!query) return true
      const matchTitle = rule.title.toLowerCase().includes(query)
      const matchFile = folderFiles.some((f) => f.originalFileName.toLowerCase().includes(query))
      return matchTitle || matchFile
    })
  }, [activeRulesList, filesByRule, searchQuery, showDeletedFiles])

  // 선택된 폴더 객체 (업무 또는 일정)
  const selectedWorkItem = useMemo(() => {
    if (folderMode !== 'tasks') return null
    if (!selectedFolderId) return filteredWorkFolders[0] ?? workItems[0] ?? null
    return workItems.find((item) => item.workItemId === selectedFolderId) ?? filteredWorkFolders[0] ?? null
  }, [folderMode, filteredWorkFolders, selectedFolderId, workItems])

  const selectedRecurringRule = useMemo(() => {
    if (folderMode !== 'schedules') return null
    const ruleIdNum = Number(selectedFolderId)
    if (!selectedFolderId || !Number.isFinite(ruleIdNum)) {
      return filteredScheduleFolders[0] ?? activeRulesList[0] ?? null
    }
    return activeRulesList.find((r) => r.ruleId === ruleIdNum) ?? filteredScheduleFolders[0] ?? null
  }, [folderMode, activeRulesList, filteredScheduleFolders, selectedFolderId])

  // 현재 활성 파일 목록
  const activeFiles = useMemo<UnifiedFileRecord[]>(() => {
    const query = searchQuery.trim().toLowerCase()

    if (folderMode === 'tasks') {
      if (!selectedWorkItem) return []
      const folderFiles = filesByWorkItem.get(selectedWorkItem.workItemId) ?? []
      if (!query) return folderFiles
      if (selectedWorkItem.title.toLowerCase().includes(query)) return folderFiles
      return folderFiles.filter((f) => f.originalFileName.toLowerCase().includes(query))
    } else {
      if (!selectedRecurringRule) return []
      const folderFiles = filesByRule.get(selectedRecurringRule.ruleId) ?? []
      if (!query) return folderFiles
      if (selectedRecurringRule.title.toLowerCase().includes(query)) return folderFiles
      return folderFiles.filter((f) => f.originalFileName.toLowerCase().includes(query))
    }
  }, [folderMode, selectedWorkItem, selectedRecurringRule, filesByWorkItem, filesByRule, searchQuery])

  // 전체 파일 개수 계산
  const totalDisplayFilesCount = useMemo(() => {
    let total = 0
    if (folderMode === 'tasks') {
      filesByWorkItem.forEach((fileList) => {
        total += fileList.length
      })
    } else {
      filesByRule.forEach((fileList) => {
        total += fileList.length
      })
    }
    return total
  }, [folderMode, filesByWorkItem, filesByRule])

  // 파일 클릭 시 내용 뷰어 열기
  const handleOpenFile = async (file: UnifiedFileRecord) => {
    setViewerFile(file)

    // 미리보기 미지원 형식은 파일 내용 API를 호출하지 않고 안내만 표시한다.
    if (!isPreviewableFile(file.originalFileName)) {
      setFileContentData(null)
      setFileError(null)
      setIsLoadingFile(false)
      return
    }

    setIsLoadingFile(true)
    setFileError(null)

    try {
      if (file.fileType === 'recurring_rule') {
        const fileId = file.fileId ?? file.id
        const res = await fetchRecurringRuleFileContent(fileId)
        setFileContentData(res)
      } else {
        const res = await fetchWorkItemFileContent(file.id)
        setFileContentData(res)
      }
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

  const handleAfterFileChange = async () => {
    if (folderMode === 'schedules') {
      await reloadRules()
    }
  }

  return (
    <div className={styles.container}>
      {fileContextMenu}
      {/* 상단 툴바 */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <div className={styles.breadcrumb}>
            <span className={styles.rootCrumb}>
              <Icon name={showDeletedFiles ? 'trash' : 'folder'} size={16} />
              <span>{showDeletedFiles ? '휴지통' : folderMode === 'tasks' ? '업무 파일' : '일정 파일'}</span>
            </span>
            {folderMode === 'tasks' && selectedWorkItem ? (
              <>
                <Icon name="chevronRight" size={13} className={styles.crumbArrow} />
                <span className={styles.activeCrumb}>
                  <Icon name="folder" size={15} />
                  <strong>{selectedWorkItem.title}</strong>
                </span>
              </>
            ) : folderMode === 'schedules' && selectedRecurringRule ? (
              <>
                <Icon name="chevronRight" size={13} className={styles.crumbArrow} />
                <span className={styles.activeCrumb}>
                  <Icon name="folder" size={15} />
                  <strong>{selectedRecurringRule.title}</strong>
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

          <button
            type="button"
            className={[styles.trashToggleBtn, showDeletedFiles ? styles.trashToggleBtnActive : ''].join(' ')}
            disabled={totalDeletedFilesCount === 0}
            onClick={() => {
              if (totalDeletedFilesCount === 0) return
              setShowDeletedFiles((prev) => !prev)
            }}
            title={
              totalDeletedFilesCount === 0
                ? '휴지통이 비어 있습니다'
                : showDeletedFiles
                  ? '휴지통 파일 숨기기'
                  : '휴지통 파일 보기'
            }
          >
            <Icon name="trash" size={14} />
            <span>휴지통{totalDeletedFilesCount > 0 ? ` (${totalDeletedFilesCount})` : ''}</span>
          </button>

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
        {/* 좌측 폴더 트리 네비게이션 */}
        <aside ref={folderSidebarRef} className={styles.folderSidebar} aria-label="폴더 목록">
          {/* 세그먼트 토글: 업무 폴더 / 일정 폴더 */}
          <div className={styles.sidebarModeToggle}>
            <button
              type="button"
              className={[styles.modeToggleBtn, folderMode === 'tasks' ? styles.modeToggleBtnActive : ''].join(' ')}
              onClick={() => setFolderMode('tasks')}
            >
              <Icon name="folder" size={14} />
              <span>업무 폴더</span>
            </button>
            <button
              type="button"
              className={[styles.modeToggleBtn, folderMode === 'schedules' ? styles.modeToggleBtnActive : ''].join(' ')}
              onClick={() => setFolderMode('schedules')}
            >
              <Icon name="rotateCcw" size={14} />
              <span>일정 폴더</span>
            </button>
          </div>

          <div className={styles.sidebarHeader}>
            <span>
              {showDeletedFiles
                ? '삭제된 폴더'
                : folderMode === 'tasks'
                  ? '업무 폴더'
                  : '일정 폴더'}{' '}
              ({folderMode === 'tasks' ? filteredWorkFolders.length : filteredScheduleFolders.length})
            </span>
            <span className={styles.sidebarTotalFiles}>
              {showDeletedFiles ? `휴지통 ${totalDisplayFilesCount}개` : `전체 ${totalDisplayFilesCount}개 파일`}
            </span>
          </div>

          <div ref={folderListRef} className={styles.folderList}>
            {folderMode === 'tasks' ? (
              filteredWorkFolders.length === 0 ? (
                <div className={styles.emptyFolderList}>
                  {showDeletedFiles ? '휴지통이 비어 있습니다.' : '검색된 업무 폴더가 없습니다.'}
                </div>
              ) : (
                filteredWorkFolders.map((item) => {
                  const isSelected = selectedWorkItem?.workItemId === item.workItemId
                  const folderFiles = filesByWorkItem.get(item.workItemId) ?? []
                  const tag = getWorkItemTag(item)

                  return (
                    <button
                      key={item.workItemId}
                      type="button"
                      data-work-item-id={item.workItemId}
                      className={[styles.folderItem, isSelected ? styles.folderItemActive : ''].join(' ')}
                      onClick={() => setSelectedFolderId(item.workItemId)}
                      onContextMenu={showDeletedFiles ? undefined : ((event) => onWorkItemContextMenu(event, item.workItemId))}
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
              )
            ) : filteredScheduleFolders.length === 0 ? (
              <div className={styles.emptyFolderList}>
                {showDeletedFiles ? '휴지통이 비어 있습니다.' : '검색된 일정 폴더가 없습니다.'}
              </div>
            ) : (
              filteredScheduleFolders.map((rule) => {
                const isSelected = selectedRecurringRule?.ruleId === rule.ruleId
                const folderFiles = filesByRule.get(rule.ruleId) ?? []

                return (
                  <button
                    key={rule.ruleId}
                    type="button"
                    className={[styles.folderItem, isSelected ? styles.folderItemActive : ''].join(' ')}
                    onClick={() => setSelectedFolderId(String(rule.ruleId))}
                  >
                    <span className={styles.folderIcon} style={{ color: '#0ea5e9' }}>
                      <Icon name="rotateCcw" size={17} />
                    </span>
                    <div className={styles.folderInfo}>
                      <span className={styles.folderName} title={rule.title}>
                        {rule.title}
                      </span>
                      <span className={styles.folderMeta}>
                        <span className={styles.tagBadge}>{rule.frequency}</span>
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
          {folderMode === 'tasks' && selectedWorkItem ? (
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
          ) : folderMode === 'schedules' && selectedRecurringRule ? (
            <div className={styles.folderDetailHeader}>
              <div className={styles.folderDetailTitle}>
                <Icon name="rotateCcw" size={20} className={styles.folderHeaderIcon} style={{ color: '#0ea5e9' }} />
                <div>
                  <div className={styles.folderDetailHeading}>
                    <h2>{selectedRecurringRule.title}</h2>
                    <span className={styles.statusPill} data-tone="info">
                      {selectedRecurringRule.category}
                    </span>
                  </div>
                  <p className={styles.folderDetailSub}>
                    반복: {selectedRecurringRule.frequency} · 기간: {selectedRecurringRule.repeatStartDate.slice(0, 10)} ~ {selectedRecurringRule.repeatEndDate ? selectedRecurringRule.repeatEndDate.slice(0, 10) : '무기한'} · 총 {activeFiles.length}개 파일
                  </p>
                </div>
              </div>

              <Link to="/workspace?view=schedules" className={styles.openTaskLink}>
                <span>일정 탭 이동</span>
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>
          ) : null}

          {/* 파일 리스트 영역 */}
          <div
            ref={filesContentRef}
            className={styles.filesContent}
            onContextMenu={(event) => {
              if (showDeletedFiles) return
              if (folderMode === 'tasks' && selectedWorkItem) {
                openUploadContextMenu(event, selectedWorkItem)
              } else if (folderMode === 'schedules' && selectedRecurringRule) {
                const target: UnifiedFolderTarget = { type: 'recurring_rule', rule: selectedRecurringRule }
                openUploadContextMenu(event, target, handleAfterFileChange)
              }
            }}
          >
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
                      className={[styles.fileCard, file.isDeleted ? styles.fileCardDeleted : ''].join(' ')}
                      onClick={() => handleOpenFile(file)}
                      onContextMenu={(event) =>
                        openFileContextMenu(event, file, {
                          onDeleted: handleAfterFileChange,
                          onRestored: handleAfterFileChange,
                        })
                      }
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
                        {file.isDeleted ? <span className={styles.deletedBadge}>휴지통</span> : null}
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
                          className={[styles.fileTableRow, file.isDeleted ? styles.fileTableRowDeleted : ''].join(' ')}
                          onClick={() => handleOpenFile(file)}
                          onContextMenu={(event) =>
                            openFileContextMenu(event, file, {
                              onDeleted: handleAfterFileChange,
                              onRestored: handleAfterFileChange,
                            })
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          <td className={styles.tdName}>
                            <Icon name={iconName} size={16} className={styles.tableFileIcon} />
                            <span className={styles.tableFileName} title={file.originalFileName}>
                              {file.originalFileName}
                            </span>
                            {file.isDeleted ? <span className={styles.deletedBadge} style={{ position: 'static' }}>휴지통</span> : null}
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

      {/* 업무 컨텍스트 메뉴 포털 */}
      {workItemContextMenu}

      {/* 파일 컨텍스트 메뉴 포털 */}
      {fileContextMenu}

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
          sourceLabel={
            viewerFile.fileType === 'recurring_rule'
              ? `일정: ${selectedRecurringRule?.title || ''}`
              : `업무: ${selectedWorkItem?.title || ''}`
          }
        />
      ) : null}
    </div>
  )
}
