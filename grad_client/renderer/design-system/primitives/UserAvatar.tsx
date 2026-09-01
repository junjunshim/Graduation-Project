import styles from './UserAvatar.module.css'

const AVATAR_TONE_CLASS_NAMES = [
  styles.violet,
  styles.blue,
  styles.green,
  styles.amber,
  styles.pink,
]

export type UserAvatarProps = {
  name: string
  userId: string
  avatarUrl?: string
  size?: 'small' | 'medium'
}

function getAvatarToneClassName(userId: string) {
  const hash = Array.from(userId).reduce((total, character) => total + character.charCodeAt(0), 0)
  return AVATAR_TONE_CLASS_NAMES[hash % AVATAR_TONE_CLASS_NAMES.length]
}

function getInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase('ko-KR') ?? '?'
}

export function UserAvatar({ name, userId, avatarUrl, size = 'small' }: UserAvatarProps) {
  return (
    <span
      className={[styles.avatar, styles[size], getAvatarToneClassName(userId)].join(' ')}
      aria-hidden="true"
    >
      {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{getInitial(name)}</span>}
    </span>
  )
}
