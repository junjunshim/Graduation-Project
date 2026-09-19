import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DocumentIcon } from '../../../design-system/primitives/DocumentIcon'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { formatActivityMessage } from '../../dashboard/model/activityFormatter'
import { FileContentViewerModal } from '../../workspace/components/FileContentViewerModal'
import { ConfirmDeleteModal } from '../../workspace/components/ConfirmDeleteModal'
import { useFileContextMenu } from '../../workspace/components/useFileContextMenu'
import { WorkItemFavoriteButton } from '../../workspace/components/WorkItemFavoriteButton'
import { fetchWorkItemFileContent } from '../../workspace/data/fileService'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getCascadeWorkItemSummary } from '../../workspace/data/cascadeWorkItemHelper'
import { addWorkItemComment, deleteWorkItem, fetchWorkItemDetail } from '../../workspace/data/workItemService'
import { subscribeToWorkspaceCache } from '../../workspace/data/workspaceCacheEvents'
import { isPreviewableFile } from '../../workspace/model/filePreview'
import {
  formatWorkspaceDate,
  formatWorkspaceTimestamp,
  getWorkItemDisplayCode,
} from '../../workspace/model/formatters'
import {
  getWorkItemPriorityMeta,
  getWorkItemStatusLabel,
  getWorkItemStatusTone,
} from '../../workspace/model/labels'
import type { ActivityRecord, WorkItemCommentRecord, WorkItemFileRecord, WorkItemRecord } from '../../workspace/model/types'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import { getWorkItemPermissions } from '../../workspace/model/workItemPermission'
import { applyProgressWeight, getChildProgressAverage } from '../../workspace/model/workItemProgress'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { CommentMentionInput, RenderCommentContent } from '../ui/CommentMentionInput'
import {
  formatContentWithMentions,
  getMentionCandidatesForWorkItem,
  type MentionCandidate,
} from '../ui/mentionUtils'
import styles from './WorkItemDetailPage.module.css'

type DetailPropertyProps = {
  icon: IconName
  label: string
  children: ReactNode
}

function DetailProperty({ icon, label, children }: DetailPropertyProps) {
  return (
    <div className={styles.property}>
      <span className={styles.propertyLabel}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <div className={styles.propertyValue}>{children}</div>
    </div>
  )
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function WorkItemDetailPage() {
  const { openFileContextMenu, openUploadContextMenu, fileContextMenu } = useFileContextMenu()
  const { workItemId } = useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const [serverLoading, setServerLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // 상세 API에서 불러온 comments 및 files 목록 (실시간 보존)
  const [comments, setComments] = useState<WorkItemCommentRecord[]>([])
  const [serverFiles, setServerFiles] = useState<WorkItemFileRecord[]>([])
  const [serverActivities, setServerActivities] = useState<ActivityRecord[]>([])

  // 댓글 입력 상태
  const [commentInput, setCommentInput] = useState('')
  const [selectedMentions, setSelectedMentions] = useState<MentionCandidate[]>([])
  const [isSubmittingComment, setIsSubmittingComment] = useState(false)
  const [commentError, setCommentError] = useState<string | null>(null)

  // 파일 미리보기 모달 상태
  const [viewerModal, setViewerModal] = useState<{
    isOpen: boolean
    file: WorkItemFileRecord | null
    content: string
    isLoading: boolean
    error: string | null
    fromCache: boolean
    lastModified?: string
  }>({
    isOpen: false,
    file: null,
    content: '',
    isLoading: false,
    error: null,
    fromCache: false,
  })

  // 업무 삭제 모달 상태
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  // 로컬 스냅샷 구독 (캐시 갱신 시 자동 리프레시)
  useEffect(() => {
    return subscribeToWorkspaceCache(() => {
      setSnapshot(getOrgSnapshot())
    })
  }, [])

  const currentUser = getCurrentUser(snapshot)

  // 서버 상세 API 호출
  const loadDetailFromServer = useCallback(
    async (targetId: string) => {
      setServerLoading(true)
      setServerError(null)
      try {
        const result = await fetchWorkItemDetail(targetId)
        setComments(result.comments)
        setServerFiles(result.files)
        setServerActivities(result.activities ?? [])
        setSnapshot(getOrgSnapshot())
      } catch (err) {
        console.warn('[WorkItemDetailPage] 업무 상세 조회 실패:', err)
        setServerError(err instanceof Error ? err.message : '업무 상세 정보를 불러오지 못했습니다.')
      } finally {
        setServerLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (workItemId) {
      window.scrollTo({ top: 0, behavior: 'instant' })
      setComments([])
      setServerFiles([])
      setServerActivities([])
      setCommentInput('')
      setCommentError(null)
      loadDetailFromServer(workItemId)
    }
  }, [workItemId, loadDetailFromServer])

  const commentListRef = useRef<HTMLDivElement>(null)

  // 댓글 작성 제출
  const handleCommentSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!workItemId || !commentInput.trim() || isSubmittingComment) return

    setIsSubmittingComment(true)
    setCommentError(null)

    // @사용자명 을 <mention email="...">@사용자명</mention> 으로 변환
    const formattedContent = formatContentWithMentions(commentInput.trim(), selectedMentions)

    try {
      const res = await addWorkItemComment(workItemId, formattedContent)
      if (res.status === 'error') {
        setCommentError(res.message)
      } else {
        setCommentInput('')
        setSelectedMentions([])
        // 댓글 재로드
        await loadDetailFromServer(workItemId)

        // 작성된 최신 댓글(맨 아래)로 부드럽게 스크롤
        setTimeout(() => {
          if (commentListRef.current) {
            commentListRef.current.scrollTo({
              top: commentListRef.current.scrollHeight,
              behavior: 'smooth',
            })
          }
        }, 80)
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : '댓글 작성에 실패했습니다.')
    } finally {
      setIsSubmittingComment(false)
    }
  }

  // 파일 클릭 시 미리보기 열기
  const handleOpenFileViewer = async (file: WorkItemFileRecord) => {
    // 미리보기 미지원 형식은 파일 내용 API를 호출하지 않고 안내만 표시한다.
    if (!isPreviewableFile(file.originalFileName)) {
      setViewerModal({
        isOpen: true,
        file,
        content: '',
        isLoading: false,
        error: null,
        fromCache: false,
      })
      return
    }

    setViewerModal({
      isOpen: true,
      file,
      content: '',
      isLoading: true,
      error: null,
      fromCache: false,
    })

    try {
      const res = await fetchWorkItemFileContent(file.id)
      setViewerModal((prev) => ({
        ...prev,
        content: res.content,
        isLoading: false,
        fromCache: res.fromCache,
        lastModified: res.lastModified,
      }))
    } catch (err) {
      setViewerModal((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : '파일 내용을 불러오지 못했습니다.',
      }))
    }
  }

  const handleCloseFileViewer = () => {
    setViewerModal((prev) => ({ ...prev, isOpen: false, file: null, content: '', error: null }))
  }

  if (!currentUser) {
    return null
  }

  const detail = workItemId
    ? getSelectedWorkItemDetail(workItemId, currentUser.userId, snapshot)
    : null

  // 업무 접근 권한이 있는 멤버만 멘션 후보로 필터링 (본인 제외, 숨김/공개 권한 비트 검사)
  const mentionCandidates = useMemo(() => {
    if (!detail?.item || !currentUser) return []
    return getMentionCandidatesForWorkItem(detail.item, currentUser.userId, snapshot)
  }, [detail?.item, currentUser, snapshot])

  // 첨부파일 합산 (서버 응답 + 스냅샷 파일)
  const allFiles = useMemo(() => {
    if (!detail) return []
    const fileMap = new Map<number, WorkItemFileRecord>()
    serverFiles
      .filter((f) => !f.isDeleted)
      .forEach((f) => fileMap.set(f.id, f))
    ;(snapshot.files ?? [])
      .filter((f) => f.workItemId === detail.item.workItemId && !f.isDeleted)
      .forEach((f) => {
        if (!fileMap.has(f.id)) {
          fileMap.set(f.id, f)
        }
      })
    return Array.from(fileMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [serverFiles, snapshot.files, detail])

  // 업무 관련 활동 로그 필터링 (업무 자체 변경 + 댓글 등록/삭제/수정 + 파일 업로드/삭제 등)
  const relatedActivities = useMemo(() => {
    if (!detail) return []
    const currentId = detail.item.workItemId

    // 현재 업무에 등록된 파일 ID 목록
    const currentFileIds = new Set<string>()
    allFiles.forEach((f) => currentFileIds.add(String(f.id)))

    // 현재 업무에 등록된 댓글 ID 목록
    const currentCommentIds = new Set<string>()
    comments.forEach((c) => currentCommentIds.add(String(c.commentId)))

    // 스냅샷 활동과 서버에서 받아온 업무 상세 활동 합산 (ID 기준 중복 제거)
    const combinedMap = new Map<number | string, ActivityRecord>()
    serverActivities.forEach((act) => combinedMap.set(act.id, act))

    const snapshotFiltered = (snapshot.activities ?? []).filter((act: ActivityRecord) => {
      const entityType = act.entityType.toUpperCase()

      // 1. WORK_ITEM 엔티티인 경우
      if (entityType === 'WORK_ITEM') {
        if (act.entityId === currentId) return true
      }

      // 2. COMMENT 엔티티인 경우
      if (entityType === 'COMMENT') {
        if (currentCommentIds.has(String(act.entityId))) return true
      }

      // 3. FILE 엔티티인 경우
      if (entityType === 'FILE') {
        if (currentFileIds.has(String(act.entityId))) return true
      }

      return false
    })

    snapshotFiltered.forEach((act) => {
      if (!combinedMap.has(act.id)) {
        combinedMap.set(act.id, act)
      }
    })

    return Array.from(combinedMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }, [serverActivities, snapshot.activities, detail, comments, allFiles])

  if (!detail && !serverLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <h2>업무를 찾을 수 없습니다.</h2>
          <p>{serverError || '요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다.'}</p>
          <Link to="/work-items" className={styles.editButton}>
            업무 목록으로 돌아가기
          </Link>
        </div>
      </section>
    )
  }

  if (!detail && serverLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <h2>업무 정보를 불러오는 중입니다...</h2>
          <p>서버에서 업무 상세 데이터를 가져오고 있습니다.</p>
        </div>
      </section>
    )
  }

  if (!detail) return null

  const { item, ownerUser, parentWorkItem, childWorkItems } = detail
  const priority = getWorkItemPriorityMeta(item.priority)
  const progress = Math.min(100, Math.max(0, item.progress))
  // 자체 진행률 + 하위 업무 진행률(가중치 반영) — 하위 업무가 없으면 같은 값이다.
  const computedProgress = Math.min(100, Math.max(0, item.computedProgress ?? progress))
  // 좌측 바는 자체 진행률, 우측 바는 하위 업무 기여분(하위 평균 × 가중치%)이다.
  // 가중치가 0이거나 하위 업무가 없으면 하위 진행률은 종합 진행률에 반영되지 않으므로 표시하지 않는다.
  const hasChildProgress = childWorkItems.length > 0 && item.weight > 0
  const childProgressAverage = hasChildProgress ? getChildProgressAverage(childWorkItems) : 0
  // 종합 진행률 = 자체 기여분 + 하위 업무 기여분
  //   자체 기여분 = 자체 진행률 × (100 - 가중치)%
  //   하위 기여분 = 하위 업무 평균 진행률 × 가중치%
  const selfProgressContribution = applyProgressWeight(progress, 100 - item.weight)
  const childProgressContribution = applyProgressWeight(childProgressAverage, item.weight)
  const description = item.description.trim() || '업무 설명이 아직 등록되지 않았습니다.'
  const categoryTag = getWorkItemTag(item)
  const statusLabel = getWorkItemStatusLabel(item.status)
  const statusTone = getWorkItemStatusTone(item.status)
  // 수정/삭제 버튼은 서버(update_work_item / delete_work_item)와 같은 기준으로 노출 여부를 정한다.
  const permissions = getWorkItemPermissions(item, currentUser.userId, snapshot)

  // 상위(부모) 업무 정보 계산
  const parentId = item.parentWorkItemId
  const parentTitle = parentWorkItem ? parentWorkItem.title : parentId

  // 직속 하위 업무 목록 (바로 아래 자식)
  const directChildren = childWorkItems ?? []

  return (
    <section className={styles.page}>
      {/* 상단 액션 바: 업무 목록 이동 & 업무 수정 */}
      <div className={styles.header}>
        <Link to="/work-items" className={styles.backLink} aria-label="업무 목록으로 이동">
          <Icon name="chevronLeft" size={14} />
          <span>업무 목록으로</span>
        </Link>

        <div className={styles.actions}>
          <WorkItemFavoriteButton workItemId={item.workItemId} />
          {permissions.canEdit ? (
            <Link to={`/work-items/${item.workItemId}/edit`} className={styles.editButton}>
              <Icon name="pencil" size={14} />
              수정
            </Link>
          ) : null}
          {permissions.canDelete ? (
            <button
              type="button"
              className={styles.deleteButton}
              onClick={() => setIsDeleteModalOpen(true)}
            >
              <Icon name="trash" size={14} />
              삭제
            </button>
          ) : null}
        </div>
      </div>

      {/* 1. 총 업무 정보 패널 */}
      <section className={styles.propertyPanel} aria-label="총 업무 정보">
        <div className={styles.propertyPanelHeader}>
          <div className={styles.panelTitleRow}>
            <Icon name="cube" size={15} />
            <h3 className={styles.propertyPanelTitle}>총 업무 정보</h3>
          </div>
        </div>

        <div className={styles.propertyColumns}>
          {/* 좌측: 총 2행 구성 (업무 코드, 업무 명, 카테고리, 우선순위 / 담당자, 생성일, 시작일, 마감일) */}
          <div className={styles.propertyLeftColumn}>
            {/* 행 1: 업무 코드, 업무 명, 카테고리, 우선순위 */}
            <div className={styles.propertyRow}>
              <DetailProperty icon="cube" label="업무 코드">
                <span className={styles.workItemCodeText}>{getWorkItemDisplayCode(item)}</span>
              </DetailProperty>

              <DetailProperty icon="fileText" label="업무 명">
                <span className={styles.workItemTitleText} title={item.title}>
                  {item.title}
                </span>
              </DetailProperty>

              <DetailProperty icon="star" label="카테고리">
                {categoryTag ? (
                  <span
                    className={styles.categoryBadge}
                    data-tone={categoryTag.tone}
                    style={categoryTag.style}
                  >
                    {categoryTag.label}
                  </span>
                ) : (
                  <span className={styles.mutedText}>미지정</span>
                )}
              </DetailProperty>

              <DetailProperty icon="trendingUp" label="우선순위">
                <span className={styles.priorityBadge} data-tone={priority.tone}>
                  {priority.symbol} {priority.label}
                </span>
              </DetailProperty>
            </div>

            <div className={styles.rowDivider} />

            {/* 행 2: 담당자, 생성일, 시작일, 마감일 */}
            <div className={styles.propertyRow}>
              <DetailProperty icon="user" label="담당자">
                <span className={styles.ownerValue}>
                  <UserAvatar name={ownerUser.name} userId={ownerUser.userId} size="small" />
                  <span className={styles.ownerName}>{ownerUser.name}</span>
                  {ownerUser.email && (
                    <span className={styles.ownerEmail}>({ownerUser.email})</span>
                  )}
                </span>
              </DetailProperty>

              <DetailProperty icon="clock" label="생성일">
                {formatWorkspaceDate(item.createdAt)}
              </DetailProperty>

              <DetailProperty icon="calendar" label="시작일">
                {formatWorkspaceDate(item.startDate)}
              </DetailProperty>

              <DetailProperty icon="calendar" label="마감일">
                {formatWorkspaceDate(item.dueDate)}
              </DetailProperty>
            </div>
          </div>

          {/* 우측: 상위 업무 및 하위 업무 (내부 스크롤 처리) */}
          <div className={styles.propertyRightColumn}>
            <DetailProperty icon="orgChart" label="상위 업무">
              {parentId ? (
                <Link
                  to={`/work-items/${parentId}`}
                  className={styles.parentLink}
                  title={`상위 업무로 이동: ${parentTitle}`}
                >
                  <Icon name="arrowRight" size={12} className={styles.parentIcon} />
                  <span className={styles.parentCode}>[{getWorkItemDisplayCode(parentWorkItem ?? { workItemId: parentId })}]</span>
                  <span className={styles.parentTitle}>{parentTitle}</span>
                </Link>
              ) : (
                <span className={styles.noParentText}>없음 (최상위 업무)</span>
              )}
            </DetailProperty>

            <div className={styles.rowDivider} />

            <DetailProperty icon="list" label={`하위 업무 (${directChildren.length})`}>
              {directChildren.length > 0 ? (
                <div className={styles.childScrollArea}>
                  <div className={styles.childList}>
                    {directChildren.map((child: WorkItemRecord) => (
                      <Link
                        key={child.workItemId}
                        to={`/work-items/${child.workItemId}`}
                        className={styles.childLink}
                        title={`하위 업무로 이동: ${child.title}`}
                      >
                        <Icon name="arrowRight" size={12} className={styles.childIcon} />
                        <span className={styles.childCode}>[{getWorkItemDisplayCode(child)}]</span>
                        <span className={styles.childTitle}>{child.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ) : (
                <span className={styles.noChildText}>없음</span>
              )}
            </DetailProperty>
          </div>
        </div>
      </section>

      {/* 본문 2열 레이아웃: 1화면 배치 (좌측: 업무 설명, 첨부파일, 활동 내역 / 우측: 진행 현황, 댓글) */}
      <div className={styles.mainGrid}>
        {/* 좌측 영역: 업무 설명 (상단), 첨부 파일 & 활동 내역 좌우 배치 (하단) */}
        <div className={styles.leftColumn}>
          {/* 2. 업무 설명 패널 */}
          <section className={`${styles.contentPanel} ${styles.descriptionPanel}`}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleRow}>
                <Icon name="fileText" size={15} />
                <h3>업무 설명</h3>
              </div>
            </div>
            <div className={styles.descriptionBody}>
              <p className={styles.description}>{description}</p>
            </div>
          </section>

          {/* 하단 2열: 첨부 파일과 활동 내역 좌우 배치 */}
          <div className={styles.leftBottomGrid}>
            {/* 5. 첨부 파일 패널 (내부 스크롤) */}
            <section
              className={styles.attachmentPanel}
              onContextMenu={(event) =>
                openUploadContextMenu(event, item, async () => {
                  const result = await fetchWorkItemDetail(item.workItemId)
                  setComments(result.comments)
                  setServerFiles(result.files)
                  setServerActivities(result.activities ?? [])
                  setSnapshot(getOrgSnapshot())
                })
              }
            >
              {fileContextMenu}
              <div className={styles.attachmentHeader}>
                <div className={styles.attachmentTitle}>
                  <Icon name="folder" size={15} />
                  <h3>첨부 파일</h3>
                  <span className={styles.countBadge}>{allFiles.length}</span>
                </div>
              </div>

              {allFiles.length === 0 ? (
                <div className={styles.emptyAttachment}>
                  <DocumentIcon size={22} />
                  <span>첨부된 파일이 없습니다.</span>
                </div>
              ) : (
                <div className={styles.fileList}>
                  {allFiles.map((file) => (
                    <div key={file.id} className={styles.fileEntry}>
                      <button
                        type="button"
                        className={styles.fileCard}
                        onClick={() => handleOpenFileViewer(file)}
                        onContextMenu={(event) =>
                          openFileContextMenu(event, file, async () => {
                            if (workItemId) {
                              await loadDetailFromServer(workItemId)
                            }
                          })
                        }
                        title="클릭하여 파일 내용 보기"
                      >
                        <div className={styles.fileIconBox}>
                          <DocumentIcon size={18} />
                        </div>
                        <div className={styles.fileInfo}>
                          <span className={styles.fileName}>{file.originalFileName}</span>
                          <div className={styles.fileMeta}>
                            <span>{formatFileSize(file.fileSize)}</span>
                            <span>•</span>
                            <span>{file.uploaderName || file.uploaderEmail || '업로더'}</span>
                          </div>
                        </div>
                        <Icon name="chevronRight" size={13} className={styles.fileArrow} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* 4. 활동 내역 패널 (내부 스크롤) */}
            <section className={`${styles.contentPanel} ${styles.activityPanel}`}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitleRow}>
                  <Icon name="lineChart" size={15} />
                  <h3>활동 내역</h3>
                  <span className={styles.countBadge}>{relatedActivities.length}</span>
                </div>
              </div>

              <div className={styles.activityList}>
                {relatedActivities.length === 0 ? (
                  <div className={styles.emptyPanelState}>
                    <Icon name="clock" size={20} />
                    <span>최근 활동 내역이 없습니다.</span>
                  </div>
                ) : (
                  <ul className={styles.activityTimeline}>
                    {relatedActivities.map((act) => {
                      const message = formatActivityMessage(act, {
                        actorName: act.actorName,
                        targetName: act.targetName,
                        resolveUserName: (userId) => snapshot.users.find((u) => u.userId === userId)?.name,
                        resolveWorkItemTitle: (wId) => snapshot.workItems.find((w) => w.workItemId === wId)?.title || detail.item.title,
                      })
                      return (
                        <li key={act.id} className={styles.activityItem}>
                          <span className={styles.timelineDot} />
                          <div className={styles.activityContent}>
                            <p className={styles.activityMessage}>{message}</p>
                            <time className={styles.activityTime}>
                              {formatWorkspaceTimestamp(act.createdAt)}
                            </time>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>
          </div>
        </div>

        {/* 우측 영역: 진행 현황, 댓글 */}
        <aside className={styles.rightColumn}>
          {/* 3. 진행 현황 패널 */}
          <section
            className={styles.progressPanel}
            aria-label={
              hasChildProgress
                ? `자체 진행률 ${progress}%, 하위 업무 기여 ${childProgressContribution}%, 가중치 반영 진행률 ${computedProgress}%`
                : `진행률 ${computedProgress}%`
            }
          >
            <div className={styles.progressHeader}>
              <div className={styles.progressTitle}>
                <Icon name="checkCircle" size={15} />
                <strong>진행 현황</strong>
                <span className={styles.statusBadge} data-tone={statusTone}>
                  {statusLabel}
                </span>
              </div>
              <strong className={styles.progressPercent}>{computedProgress}%</strong>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span className={styles.progressFillSelf} style={{ width: `${progress}%` }} />
              {hasChildProgress ? (
                <span className={styles.progressFillChild} style={{ width: `${childProgressContribution}%` }} />
              ) : null}
            </div>
            <ul className={styles.progressLegend}>
              <li className={styles.progressLegendItem}>
                <span className={styles.progressLegendLabel}>
                  <i className={[styles.progressLegendDot, styles.progressLegendDotSelf].join(' ')} />
                  자체 진행률
                </span>
                <span className={styles.progressLegendValue}>
                  {progress}%
                  {hasChildProgress ? <em>기여 {selfProgressContribution}%</em> : null}
                </span>
              </li>
              {hasChildProgress ? (
                <li className={styles.progressLegendItem}>
                  <span className={styles.progressLegendLabel}>
                    <i className={[styles.progressLegendDot, styles.progressLegendDotChild].join(' ')} />
                    하위 업무 평균
                  </span>
                  <span className={styles.progressLegendValue}>
                    {childProgressAverage}%
                    <em>× {item.weight}% = {childProgressContribution}%</em>
                  </span>
                </li>
              ) : null}
              {hasChildProgress ? (
                <li className={styles.progressLegendItem} data-total="true">
                  <span className={styles.progressLegendLabel}>종합 진행률</span>
                  <span className={styles.progressLegendValue}>
                    {selfProgressContribution}% + {childProgressContribution}% = {computedProgress}%
                  </span>
                </li>
              ) : null}
            </ul>
          </section>

          {/* 6. 댓글 패널 (내부 스크롤) */}
          <section className={`${styles.contentPanel} ${styles.commentsPanel}`}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleRow}>
                <Icon name="messageCircle" size={15} />
                <h3>댓글</h3>
                <span className={styles.countBadge}>{comments.length}</span>
              </div>
            </div>

            {/* 내부 스크롤 댓글 목록 */}
            <div ref={commentListRef} className={styles.commentList}>
              {comments.length === 0 ? (
                <div className={styles.emptyPanelState}>
                  <Icon name="messageCircle" size={20} />
                  <span>등록된 댓글이 없습니다. 첫 댓글을 남겨보세요.</span>
                </div>
              ) : (
                comments.map((comment) => (
                  <div key={comment.commentId} className={styles.commentItem}>
                    <div className={styles.commentAvatar}>
                      <UserAvatar
                        name={comment.authorName}
                        userId={comment.authorUserId}
                        size="small"
                      />
                    </div>
                    <div className={styles.commentContentWrapper}>
                      <div className={styles.commentMeta}>
                        <strong className={styles.commentAuthor}>{comment.authorName}</strong>
                        {comment.authorEmail && (
                          <span className={styles.commentAuthorEmail}>({comment.authorEmail})</span>
                        )}
                        <span className={styles.commentTime}>
                          {formatWorkspaceTimestamp(comment.createdAt)}
                        </span>
                      </div>
                      <div className={styles.commentBody}>
                        <RenderCommentContent content={comment.content} />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 하단 고정 댓글 작성 폼 */}
            <form className={styles.commentForm} onSubmit={handleCommentSubmit}>
              <div className={styles.commentInputWrapper}>
                <CommentMentionInput
                  placeholder="댓글이나 업무 진행 상황을 작성하세요... (@를 입력하여 팀원 멘션)"
                  value={commentInput}
                  onChange={setCommentInput}
                  candidates={mentionCandidates}
                  selectedMentions={selectedMentions}
                  onSelectCandidate={(candidate) => {
                    setSelectedMentions((prev) => {
                      if (prev.some((m) => m.userId === candidate.userId)) return prev
                      return [...prev, candidate]
                    })
                  }}
                  onRemoveMention={(candidate) => {
                    setSelectedMentions((prev) => prev.filter((m) => m.userId !== candidate.userId))
                  }}
                  rows={2}
                  disabled={isSubmittingComment}
                />
                <div className={styles.commentFormFooter}>
                  {commentError && <span className={styles.commentError}>{commentError}</span>}
                  <button
                    type="submit"
                    className={styles.commentSubmitButton}
                    disabled={!commentInput.trim() || isSubmittingComment}
                  >
                    <Icon name="plus" size={13} />
                    {isSubmittingComment ? '등록 중...' : '댓글 등록'}
                  </button>
                </div>
              </div>
            </form>
          </section>
        </aside>
      </div>

      {/* 파일 내용 뷰어 모달 */}
      <FileContentViewerModal
        isOpen={viewerModal.isOpen}
        onClose={handleCloseFileViewer}
        fileName={viewerModal.file?.originalFileName || ''}
        content={viewerModal.content}
        fileSize={viewerModal.file?.fileSize}
        lastModified={viewerModal.lastModified}
        fromCache={viewerModal.fromCache}
        sourceLabel={`업무 첨부파일 [${item.workItemId}]`}
        isLoading={viewerModal.isLoading}
        error={viewerModal.error}
      />

      {isDeleteModalOpen && (() => {
        const cascadeSummary = getCascadeWorkItemSummary(
          item.workItemId,
          snapshot.workItems,
          snapshot.files ?? [],
          false,
        )
        const cascadeFiles = cascadeSummary ? cascadeSummary.allFiles : allFiles.map((f) => ({ id: f.id, name: f.originalFileName, size: f.fileSize, workItemId: f.workItemId, workItemTitle: item.title }))
        const cascadeChildren = cascadeSummary
          ? cascadeSummary.descendantWorkItems.map((c) => ({ id: c.workItemId, title: c.title }))
          : directChildren.map((c: WorkItemRecord) => ({ id: c.workItemId, title: c.title }))

        return (
          <ConfirmDeleteModal
            isOpen={isDeleteModalOpen}
            title="업무 삭제"
            itemName={item.title}
            itemTypeLabel="업무"
            warningText="삭제된 업무는 휴지통으로 이동되며 15일간 보관 후 영구 삭제됩니다."
            attachedFiles={cascadeFiles}
            childWorkItems={cascadeChildren}
            childCount={cascadeChildren.length}
            onClose={() => setIsDeleteModalOpen(false)}
            onConfirm={async () => {
            try {
              const { showToast } = await import('../../notification/data/toastEvents')
              const latestSnapshot = getOrgSnapshot()
              const latestItem = latestSnapshot.workItems.find(
                (candidate) => candidate.workItemId === item.workItemId,
              )

              // 모달이 열린 뒤 권한이 바뀌었을 수 있으므로 제출 직전에 한 번 더 확인한다.
              if (
                !latestItem ||
                !getWorkItemPermissions(
                  latestItem,
                  getCurrentUser(latestSnapshot)?.userId ?? null,
                  latestSnapshot,
                ).canDelete
              ) {
                showToast({
                  title: '업무 삭제 실패',
                  content: '업무를 삭제할 권한이 없습니다.',
                  created_at: new Date().toISOString(),
                })
                setIsDeleteModalOpen(false)
                return
              }

              const res = await deleteWorkItem(item.workItemId)
              if (res.status === 'error') {
                showToast({
                  title: '업무 삭제 실패',
                  content: res.message || '업무를 삭제하지 못했습니다.',
                  created_at: new Date().toISOString(),
                })
              } else {
                showToast({
                  title: '업무 삭제 완료',
                  content: `'${item.title}' 업무가 삭제되어 휴지통으로 이동되었습니다.`,
                  created_at: new Date().toISOString(),
                })
                navigate(`/workspace?nodeId=${item.ownerNodeId}`)
              }
            } catch (error) {
              const { showToast } = await import('../../notification/data/toastEvents')
              showToast({
                title: '업무 삭제 실패',
                content: error instanceof Error ? error.message : '업무를 삭제하지 못했습니다.',
                created_at: new Date().toISOString(),
              })
            } finally {
              setIsDeleteModalOpen(false)
            }
          }}
        />
      )})()}
    </section>
  )
}
