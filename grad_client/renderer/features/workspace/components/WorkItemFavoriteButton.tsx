import { useEffect, useState } from 'react'
import { getCurrentUser } from '../../auth/api'
import { Icon } from '../../../design-system/primitives/Icon'
import { getFavoriteWorkItemIds, toggleFavoriteWorkItem } from '../data/workItemFavorites'
import styles from './FileContextMenu.module.css'

export function WorkItemFavoriteButton({ workItemId, menu = false, onToggle }: { workItemId: string; menu?: boolean; onToggle?: () => void }) {
  const userId = getCurrentUser()?.userId
  const [, refresh] = useState(0)
  useEffect(() => {
    const update = () => refresh((value) => value + 1)
    window.addEventListener('grad-client-favorites-updated', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('grad-client-favorites-updated', update); window.removeEventListener('storage', update) }
  }, [])
  const selected = getFavoriteWorkItemIds(userId).includes(workItemId)
  return <button type="button" className={styles.item} role={menu ? 'menuitem' : undefined}
    aria-pressed={menu ? undefined : selected} disabled={!userId}
    onClick={() => { toggleFavoriteWorkItem(workItemId, userId); onToggle?.() }}>
    <Icon name="star" size={15} fill={selected ? 'currentColor' : 'none'} />
    <span>{selected ? '즐겨찾기 해제' : '즐겨찾기 추가'}</span>
  </button>
}
