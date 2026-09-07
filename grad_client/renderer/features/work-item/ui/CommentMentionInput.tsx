import { useState, useRef, useEffect, type KeyboardEvent, type ChangeEvent, type UIEvent } from 'react'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { MentionCandidate } from './mentionUtils'
import styles from './CommentMentionInput.module.css'

type CommentMentionInputProps = {
  value: string
  onChange: (value: string) => void
  candidates: MentionCandidate[]
  onSelectCandidate: (candidate: MentionCandidate) => void
  selectedMentions?: MentionCandidate[]
  onRemoveMention?: (candidate: MentionCandidate) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}

export function CommentMentionInput({
  value,
  onChange,
  candidates,
  onSelectCandidate,
  selectedMentions = [],
  onRemoveMention,
  placeholder = '댓글을 입력하세요...',
  rows = 3,
  disabled = false,
}: CommentMentionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [mentionStartIndex, setMentionStartIndex] = useState<number | null>(null)

  // 쿼리에 따른 필터링된 후보 목록
  const filteredCandidates = candidates.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.email.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 키보드로 위/아래 이동 시 선택된 항목이 보이도록 드롭다운 자동 스크롤
  useEffect(() => {
    if (isOpen && dropdownRef.current) {
      const selectedEl = dropdownRef.current.querySelector(
        `.${styles.candidateItemSelected}`
      ) as HTMLElement | null
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
  }, [selectedIndex, isOpen])

  // 스크롤 동기화
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    if (backdropRef.current) {
      backdropRef.current.scrollTop = e.currentTarget.scrollTop
      backdropRef.current.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    const cursorPos = e.target.selectionStart
    onChange(text)

    // 커서 바로 앞의 텍스트 분석하여 '@' 감지
    const textBeforeCursor = text.slice(0, cursorPos)
    const atIndex = textBeforeCursor.lastIndexOf('@')

    if (atIndex !== -1) {
      // '@' 앞이 공백이거나 줄의 첫 문자여야 멘션으로 인정
      const charBeforeAt = atIndex > 0 ? textBeforeCursor[atIndex - 1] : ' '
      const queryText = textBeforeCursor.slice(atIndex + 1)

      // 공백이나 개행이 포함되지 않은 경우에만 자동완성 팝업 활성화
      if (/[\s\n]/.test(charBeforeAt) || atIndex === 0) {
        if (!/[\s\n]/.test(queryText)) {
          setMentionStartIndex(atIndex)
          setQuery(queryText)
          setIsOpen(true)
          return
        }
      }
    }

    setIsOpen(false)
    setMentionStartIndex(null)

    // 사용자가 텍스트에서 백스페이스로 @이름을 지웠을 때 하단 멘션 뱃지 목록도 자동 동기화
    if (onRemoveMention && selectedMentions.length > 0) {
      selectedMentions.forEach((m) => {
        if (!text.includes(`@${m.name}`)) {
          onRemoveMention(m)
        }
      })
    }
  }

  const handleRemoveMention = (candidate: MentionCandidate) => {
    // 1. textarea 텍스트에서 @이름 제거
    const target = `@${candidate.name}`
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`\\s*${escaped}\\s?`, 'g')
    const newText = value.replace(regex, ' ').replace(/\s{2,}/g, ' ').trimStart()
    onChange(newText)

    // 2. 부모 콜백 호출하여 selectedMentions에서 제거
    onRemoveMention?.(candidate)

    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }

  const applyMention = (candidate: MentionCandidate) => {
    if (mentionStartIndex === null || !textareaRef.current) return

    const cursorPos = textareaRef.current.selectionStart
    const before = value.slice(0, mentionStartIndex)
    const after = value.slice(cursorPos)

    const newText = `${before}@${candidate.name} ${after}`
    onChange(newText)
    onSelectCandidate(candidate)

    setIsOpen(false)
    setMentionStartIndex(null)

    // 커서 위치 재조정
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = mentionStartIndex + candidate.name.length + 2 // '@' + name + ' '
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
        textareaRef.current.focus()
      }
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen || filteredCandidates.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % filteredCandidates.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filteredCandidates.length) % filteredCandidates.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      applyMention(filteredCandidates[selectedIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  // textarea 배경 하이라이트용 렌더러 (오직 선택 확정된 멘션 대상자만 하이라이트)
  const renderBackdropContent = () => {
    if (!value || selectedMentions.length === 0) return null

    // 실제 선택된 멘션 대상자들의 이름만 긴 이름 순서대로 정렬
    const candidateNames = Array.from(
      new Set(selectedMentions.map((c) => c.name.trim()))
    ).filter(Boolean).sort((a, b) => b.length - a.length)

    if (candidateNames.length === 0) return null

    // 특수문자 이스케이프 함수
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`(@(?:${candidateNames.map(escape).join('|')}))`, 'g')

    const parts = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = regex.exec(value)) !== null) {
      if (match.index > lastIndex) {
        parts.push(value.slice(lastIndex, match.index))
      }
      parts.push(
        <mark key={`mark-${match.index}`} className={styles.highlight}>
          {match[1]}
        </mark>
      )
      lastIndex = regex.lastIndex
    }

    if (lastIndex < value.length) {
      parts.push(value.slice(lastIndex))
    }

    return (
      <>
        {parts}
        {value.endsWith('\n') && '\n '}
      </>
    )
  }

  return (
    <div className={styles.wrapper}>
      {isOpen && (
        <div ref={dropdownRef} className={styles.dropdown} role="listbox" aria-label="멘션할 멤버 선택">
          <div className={styles.dropdownHeader}>멤버 멘션하기 (@)</div>
          {filteredCandidates.length === 0 ? (
            <div className={styles.emptyCandidates}>일치하는 멤버가 없습니다.</div>
          ) : (
            filteredCandidates.map((candidate, idx) => (
              <button
                key={candidate.userId}
                type="button"
                className={`${styles.candidateItem} ${idx === selectedIndex ? styles.candidateItemSelected : ''}`}
                onClick={() => applyMention(candidate)}
                onMouseEnter={() => setSelectedIndex(idx)}
                role="option"
                aria-selected={idx === selectedIndex}
              >
                <UserAvatar name={candidate.name} userId={candidate.userId} size="small" />
                <div className={styles.candidateInfo}>
                  <span className={styles.candidateName}>{candidate.name}</span>
                  <span className={styles.candidateEmail}>{candidate.email}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}

      <div className={styles.inputContainer}>
        <div ref={backdropRef} className={styles.backdrop} aria-hidden="true">
          {renderBackdropContent()}
        </div>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          placeholder={placeholder}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          rows={rows}
          disabled={disabled}
        />
      </div>

      {/* 선택된 멘션 대상자 파란색 뱃지 목록 */}
      {selectedMentions.length > 0 && (
        <div className={styles.selectedMentionsBar}>
          <span className={styles.selectedMentionsLabel}>멘션 대상:</span>
          {selectedMentions.map((user) => (
            <span key={user.userId} className={styles.selectedTag}>
              @{user.name}
              {onRemoveMention && (
                <button
                  type="button"
                  className={styles.removeTagBtn}
                  onClick={() => handleRemoveMention(user)}
                  title="멘션 해제"
                >
                  ✕
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * <mention email="...">@이름</mention> 태그 또는 @이름 패턴을 파싱하여 하이라이트 배지로 렌더링하는 컴포넌트
 */
export function RenderCommentContent({ content }: { content: string }) {
  if (!content) return null

  // 오직 서버 표준 규격인 <mention email="...">@이름</mention> 태그만 멘션 칩으로 파싱
  const regex = /<mention(?:\s+[^>]*)?email=["']([^"']+)["'][^>]*>([\s\S]*?)<\/mention>/gi
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index)
      elements.push(renderTextWithNewlines(textBefore, `pre-${match.index}`))
    }

    // <mention email="...">@이름</mention> 태그 매칭
    const email = match[1]
    const rawName = match[2].trim()
    const displayName = rawName.startsWith('@') ? rawName : `@${rawName}`
    elements.push(
      <span key={`mention-${match.index}`} className={styles.mentionChip} title={email}>
        {displayName}
      </span>
    )

    lastIndex = regex.lastIndex
  }

  if (lastIndex < content.length) {
    const textRemaining = content.substring(lastIndex)
    elements.push(renderTextWithNewlines(textRemaining, `post-${lastIndex}`))
  }

  return <>{elements}</>
}

function renderTextWithNewlines(text: string, keyPrefix: string) {
  const lines = text.split('\n')
  return (
    <span key={keyPrefix}>
      {lines.map((line, idx) => (
        <span key={`${keyPrefix}-${idx}`}>
          {line}
          {idx < lines.length - 1 && <br />}
        </span>
      ))}
    </span>
  )
}
