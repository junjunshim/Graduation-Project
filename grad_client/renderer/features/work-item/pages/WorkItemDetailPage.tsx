import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DocumentIcon } from '../../../design-system/primitives/DocumentIcon'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { formatActivityMessage } from '../../dashboard/model/activityFormatter'
import { FileContentViewerModal } from '../../workspace/components/FileContentViewerModal'
import { fetchWorkItemFileContent } from '../../workspace/data/fileService'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { addWorkItemComment, fetchWorkItemDetail } from '../../workspace/data/workItemService'
import { subscribeToWorkspaceCache } from '../../workspace/data/workspaceCacheEvents'
import { formatWorkspaceDate, formatWorkspaceTimestamp } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { ActivityRecord, WorkItemCommentRecord, WorkItemFileRecord } from '../../workspace/model/types'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
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

function getPriorityMeta(priority: number) {
  if (priority <= 1) {
    return { label: '매우 높음', symbol: '↑↑', tone: 'highest' }
  }

  if (priority === 2) {
    return { label: '높음', symbol: '↑', tone: 'high' }
  }

  if (priority === 3) {
    return { label: '보통', symbol: '−', tone: 'medium' }
  }

  if (priority === 4) {
    return { label: '낮음', symbol: '↓', tone: 'low' }
  }

  return { label: '매우 낮음', symbol: '↓↓', tone: 'lowest' }
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export function WorkItemDetailPage() {
  const { workItemId } = useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const [serverLoading, setServerLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // 상세 API에서 불러온 comments 및 files 목록 (실시간 보존)
  const [comments, setComments] = useState<WorkItemCommentRecord[]>([])
  const [serverFiles, setServerFiles] = useState<WorkItemFileRecord[]>([])

  // 댓글 입력 상태
  const [commentInput, setCommentInput] = useState('')
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
      setCommentInput('')
      setCommentError(null)
      loadDetailFromServer(workItemId)
    }
  }, [workItemId, loadDetailFromServer])

  // 댓글 작성 제출
  const handleCommentSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!workItemId || !commentInput.trim() || isSubmittingComment) return

    setIsSubmittingComment(true)
    setCommentError(null)

    try {
      const res = await addWorkItemComment(workItemId, commentInput.trim())
      if (res.status === 'error') {
        setCommentError(res.message)
      } else {
        setCommentInput('')
        // 댓글 재로드
        await loadDetailFromServer(workItemId)
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : '댓글 작성에 실패했습니다.')
    } finally {
      setIsSubmittingComment(false)
    }
  }

  // 파일 클릭 시 미리보기 열기
  const handleOpenFileViewer = async (file: WorkItemFileRecord) => {
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

  // 첨부파일 합산 (서버 응답 + 스냅샷 파일)
  const allFiles = useMemo(() => {
    if (!detail) return []
    const fileMap = new Map<number, WorkItemFileRecord>()
    serverFiles.forEach((f) => fileMap.set(f.id, f))
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
    const targetTitle = detail.item.title.trim()

    // 현재 업무에 등록된 파일 ID 목록
    const currentFileIds = new Set<string>()
    allFiles.forEach((f) => currentFileIds.add(String(f.id)))

    // 현재 업무에 등록된 댓글 ID 목록
    const currentCommentIds = new Set<string>()
    comments.forEach((c) => currentCommentIds.add(String(c.commentId)))

    return (snapshot.activities ?? [])
      .filter((act: ActivityRecord) => {
        const entityType = act.entityType.toUpperCase()

        // 1. WORK_ITEM 엔티티인 경우
        if (entityType === 'WORK_ITEM') {
          if (act.entityId === currentId) return true
          if (act.targetName === targetTitle) return true
        }

        // 2. COMMENT 엔티티인 경우
        if (entityType === 'COMMENT') {
          // targetName 예: 'Comment on WI-206'
          const matchedWorkItemId = act.targetName ? act.targetName.replace(/^Comment on\s*/i, '').trim() : ''
          if (matchedWorkItemId === currentId) return true
          if (currentCommentIds.has(String(act.entityId))) return true
        }

        // 3. FILE 엔티티인 경우
        if (entityType === 'FILE') {
          if (currentFileIds.has(String(act.entityId))) return true
        }

        return false
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [snapshot.activities, detail, comments, allFiles])

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
  const priority = getPriorityMeta(item.priority)
  const progress = Math.min(100, Math.max(0, item.progress))
  const description = item.description.trim() || '업무 설명이 아직 등록되지 않았습니다.'
  const categoryTag = getWorkItemTag(item)
  const statusLabel = getWorkItemStatusLabel(item.status)
  const statusTone = getWorkItemStatusTone(item.status)

  // 상위(부모) 업무 정보 계산
  const parentId = item.parentWorkItemId
  const parentTitle = parentWorkItem ? parentWorkItem.title : parentId

  // 직속 하위 업무 목록 (바로 아래 자식)
  const directChildren = childWorkItems ?? []

  return (
    <section className={styles.page}>
      {/* 상단 액션 바: 뒤로가기 & 업무 수정 */}
      <div className={styles.header}>
        <button
          type="button"
          className={styles.backLink}
          onClick={() => navigate(-1)}
          aria-label="이전 페이지로 이동"
        >
          <Icon name="chevronLeft" size={14} />
          <span>뒤로가기</span>
        </button>

        <div className={styles.actions}>
          <Link to={`/work-items/${item.workItemId}/edit`} className={styles.editButton}>
            <Icon name="pencil" size={14} />
            수정
          </Link>
        </div>
      </div>

      {/* 업무 주요 메타 속성 바: 3개 행으로 여유롭고 명확하게 구조화 */}
      <section className={styles.propertyPanel} aria-label="업무 주요 정보">
        {/* 행 1: 업무 코드, 업무 명, 카테고리, 우선순위 */}
        <div className={styles.propertyRow}>
          <DetailProperty icon="cube" label="업무 코드">
            <span className={styles.workItemCodeText}>{item.workItemId}</span>
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
              <UserAvatar name={ownerUser.name} userId={ownerUser.userId} size="medium" />
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

        <div className={styles.rowDivider} />

        {/* 행 3: 상위 업무 & 하위 업무 (직속 하위만) */}
        <div className={styles.hierarchyRow}>
          <div className={styles.hierarchyColumn}>
            <DetailProperty icon="orgChart" label="상위 업무">
              {parentId ? (
                <Link
                  to={`/work-items/${parentId}`}
                  className={styles.parentLink}
                  title={`상위 업무로 이동: ${parentTitle}`}
                >
                  <Icon name="arrowRight" size={12} className={styles.parentIcon} />
                  <span className={styles.parentCode}>[{parentId}]</span>
                  <span className={styles.parentTitle}>{parentTitle}</span>
                </Link>
              ) : (
                <span className={styles.noParentText}>없음 (최상위 업무)</span>
              )}
            </DetailProperty>
          </div>

          <div className={styles.hierarchyColumn}>
            <DetailProperty icon="list" label={`하위 업무 (${directChildren.length})`}>
              {directChildren.length > 0 ? (
                <div className={styles.childList}>
                  {directChildren.map((child) => (
                    <Link
                      key={child.workItemId}
                      to={`/work-items/${child.workItemId}`}
                      className={styles.childLink}
                      title={`하위 업무로 이동: ${child.title}`}
                    >
                      <Icon name="arrowRight" size={12} className={styles.childIcon} />
                      <span className={styles.childCode}>[{child.workItemId}]</span>
                      <span className={styles.childTitle}>{child.title}</span>
                    </Link>
                  ))}
                </div>
              ) : (
                <span className={styles.noChildText}>없음</span>
              )}
            </DetailProperty>
          </div>
        </div>
      </section>

      {/* 상단 2열 본문 레이아웃: 좌측(설명, 활동 내역) + 우측(진행 현황, 첨부파일) */}
      <div className={styles.detailLayout}>
        <div className={styles.primaryColumn}>
          {/* 1. 업무 설명 */}
          <section className={`${styles.contentPanel} ${styles.descriptionPanel}`}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleRow}>
                <Icon name="fileText" size={16} />
                <h3>업무 설명</h3>
              </div>
            </div>
            <div className={styles.descriptionBody}>
              <p className={styles.description}>{description}</p>
            </div>
          </section>

          {/* 2. 활동 내역 (Activity Timeline) */}
          <section className={`${styles.contentPanel} ${styles.activityPanel}`}>
            <div className={styles.panelHeader}>
              <div className={styles.panelTitleRow}>
                <Icon name="lineChart" size={16} />
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

        {/* 우측 사이드 패널: 진행 현황, 첨부파일 */}
        <aside className={styles.secondaryColumn}>
          {/* 진행 현황 */}
          <section className={styles.progressPanel} aria-label={`진행률 ${progress}%`}>
            <div className={styles.progressHeader}>
              <div className={styles.progressTitle}>
                <Icon name="checkCircle" size={15} />
                <strong>진행 현황</strong>
              </div>
              <strong className={styles.progressPercent}>{progress}%</strong>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.progressFooter}>
              <span>가중치: {item.weight}</span>
              <span className={styles.statusBadge} data-tone={statusTone}>
                {statusLabel}
              </span>
            </div>
          </section>

          {/* 첨부파일 */}
          <section className={styles.attachmentPanel}>
            <div className={styles.attachmentHeader}>
              <div className={styles.attachmentTitle}>
                <Icon name="folder" size={15} />
                <h3>첨부파일</h3>
                <span className={styles.countBadge}>{allFiles.length}</span>
              </div>
            </div>

            {allFiles.length === 0 ? (
              <div className={styles.emptyAttachment}>
                <DocumentIcon size={24} />
                <span>첨부된 파일이 없습니다.</span>
              </div>
            ) : (
              <div className={styles.fileList}>
                {allFiles.map((file) => (
                  <button
                    key={file.id}
                    type="button"
                    className={styles.fileCard}
                    onClick={() => handleOpenFileViewer(file)}
                    title="클릭하여 파일 내용 보기"
                  >
                    <div className={styles.fileIconBox}>
                      <DocumentIcon size={20} />
                    </div>
                    <div className={styles.fileInfo}>
                      <span className={styles.fileName}>{file.originalFileName}</span>
                      <div className={styles.fileMeta}>
                        <span>{formatFileSize(file.fileSize)}</span>
                        <span>•</span>
                        <span>{file.uploaderName || file.uploaderEmail || '업로더'}</span>
                      </div>
                    </div>
                    <Icon name="chevronRight" size={14} className={styles.fileArrow} />
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* 최하단 전폭 댓글 (Comments) 섹션 */}
      <section className={`${styles.contentPanel} ${styles.commentsPanel}`}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitleRow}>
            <Icon name="messageCircle" size={16} />
            <h3>댓글</h3>
            <span className={styles.countBadge}>{comments.length}</span>
          </div>
        </div>

        {/* 댓글 작성 폼 */}
        <form className={styles.commentForm} onSubmit={handleCommentSubmit}>
          <div className={styles.commentInputWrapper}>
            <textarea
              className={styles.commentInput}
              placeholder="댓글이나 업무 진행 상황을 작성하세요..."
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              rows={3}
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

        {/* 댓글 목록 */}
        <div className={styles.commentList}>
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
                    size="medium"
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
                  <div className={styles.commentBody}>{comment.content}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

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
    </section>
  )
}
