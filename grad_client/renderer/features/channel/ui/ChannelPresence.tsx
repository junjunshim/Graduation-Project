import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { ChannelParticipant } from '../model/channelTypes'
import styles from './ChannelPresence.module.css'

type ChannelPresenceProps = {
  channelId: number
  channelType: 'WORKSPACE' | 'DM'
  participants: ChannelParticipant[]
  isPresenceReady: boolean
  currentUserEmail: string
  counterpartEmail?: string
}

const MAX_VISIBLE_AVATARS = 4

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

export function ChannelPresence({
  channelId,
  channelType,
  participants,
  isPresenceReady,
  currentUserEmail,
  counterpartEmail,
}: ChannelPresenceProps) {
  const [isOpen, setIsOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const normalizedCurrentEmail = normalizeEmail(currentUserEmail)

  // 접속 중인 사용자를 먼저 보여 주고, 같은 상태에서는 이름순으로 정렬한다.
  const orderedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      if (a.online !== b.online) {
        return a.online ? -1 : 1
      }
      return a.name.localeCompare(b.name, 'ko')
    })
  }, [participants])

  const onlineCount = orderedParticipants.filter((participant) => participant.online).length

  // DM 은 상대방 한 명의 앱 접속 상태만 보여 준다.
  const counterpart = useMemo(() => {
    if (channelType !== 'DM') return null

    const targetEmail = counterpartEmail ? normalizeEmail(counterpartEmail) : ''
    return (
      participants.find(
        (participant) =>
          participant.email !== normalizedCurrentEmail &&
          (!targetEmail || participant.email === targetEmail),
      ) ?? null
    )
  }, [channelType, counterpartEmail, participants, normalizedCurrentEmail])

  useEffect(() => {
    setIsOpen(false)
  }, [channelId])

  useEffect(() => {
    if (!isOpen) return

    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  if (channelType === 'DM') {
    const isCounterpartOnline = counterpart?.online === true
    const statusLabel = !isPresenceReady
      ? '접속 상태 확인 중'
      : isCounterpartOnline
        ? '접속 중'
        : '오프라인'

    return (
      <div
        className={`${styles.dmStatus} ${isCounterpartOnline ? styles.dmStatusOnline : ''}`}
        title={counterpart ? counterpart.email : counterpartEmail}
      >
        <span
          className={`${styles.statusDot} ${isCounterpartOnline ? styles.statusDotOnline : ''}`}
          aria-hidden="true"
        />
        <span>{statusLabel}</span>
      </div>
    )
  }

  if (orderedParticipants.length === 0) {
    return null
  }

  const visibleParticipants = orderedParticipants.slice(0, MAX_VISIBLE_AVATARS)
  const hiddenCount = orderedParticipants.length - visibleParticipants.length

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={`채널 사용자 ${orderedParticipants.length}명 보기, ${onlineCount}명 접속 중`}
        aria-expanded={isOpen}
        title={`이 채널을 볼 수 있는 사용자 ${orderedParticipants.length}명 (접속 중 ${onlineCount}명)`}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className={styles.iconWrap} aria-hidden="true">
          <Icon name="users" size={13} />
        </span>
        <span className={styles.avatarStack}>
          {visibleParticipants.map((participant) => (
            <span key={participant.email} className={styles.avatarStackItem}>
              <UserAvatar
                name={participant.name}
                userId={participant.email}
                size="small"
              />
              {participant.online ? (
                <span className={styles.avatarStatusDotOnline} aria-hidden="true" />
              ) : null}
            </span>
          ))}
          {hiddenCount > 0 ? <span className={styles.moreCount}>+{hiddenCount}</span> : null}
        </span>
        <span className={styles.countLabel}>{orderedParticipants.length}명</span>
      </button>

      {isOpen ? (
        <div className={styles.popover} role="dialog" aria-label="채널 사용자 목록">
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>채널 사용자</span>
            <span className={styles.popoverCount}>
              {onlineCount}명 접속 중 · 전체 {orderedParticipants.length}명
            </span>
          </div>
          <ul className={styles.list}>
            {orderedParticipants.map((participant) => {
              const isSelf = participant.email === normalizedCurrentEmail

              return (
                <li key={participant.email} className={styles.item}>
                  <span className={styles.avatarWrap}>
                    <UserAvatar
                      name={participant.name}
                      userId={participant.email}
                      size="medium"
                    />
                    <span
                      className={`${styles.avatarStatusDot} ${
                        participant.online ? styles.avatarStatusDotOnline : ''
                      }`}
                      aria-hidden="true"
                    />
                  </span>
                  <span className={styles.itemMeta}>
                    <span className={styles.itemNameRow}>
                      <span className={styles.itemName}>{participant.name}</span>
                      {isSelf ? <span className={styles.selfBadge}>나</span> : null}
                    </span>
                    <span className={styles.itemEmail}>{participant.email}</span>
                  </span>
                  <span
                    className={`${styles.itemStatus} ${
                      participant.online ? styles.itemStatusOnline : ''
                    }`}
                  >
                    {participant.online ? '접속 중' : '오프라인'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
