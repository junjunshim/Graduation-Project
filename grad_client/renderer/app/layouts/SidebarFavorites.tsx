import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import { getOrgSnapshot } from '../../features/workspace/data/orgService'
import { getWorkspaceOverview } from '../../features/workspace/queries/workspaceOverview'
import { subscribeToWorkspaceCache } from '../../features/workspace/data/workspaceCacheEvents'
import { getFavoriteWorkspaceIds, toggleFavoriteWorkspaceId, selectWorkspaceRoot } from '../../features/workspace/data/workspaceDirectorySelection'
import styles from './AppShell.module.css'
import modalStyles from './SidebarFavorites.module.css'
import { getFavoriteWorkItemIds, toggleFavoriteWorkItem } from '../../features/workspace/data/workItemFavorites'

type FavoriteType = 'workspace' | 'work-item' | 'channel'
type FavoriteOption = { type: FavoriteType; id: string; name: string; path: string }
const FAVORITES_EVENT = 'grad-client-favorites-updated'


export function SidebarFavorites({ userId }: { userId: string }) {
  const [, refresh] = useState(0)
  const [isOpen, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'workspace' | 'work-item'>('workspace')
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const update = () => refresh((value) => value + 1)
    const unsubscribe = subscribeToWorkspaceCache(update)
    window.addEventListener(FAVORITES_EVENT, update)
    window.addEventListener('storage', update)
    return () => { unsubscribe(); window.removeEventListener(FAVORITES_EVENT, update); window.removeEventListener('storage', update) }
  }, [])
  useEffect(() => {
    if (isOpen) dialogRef.current?.showModal()
  }, [isOpen])

  const overview = getWorkspaceOverview(userId, getOrgSnapshot())
  const workspaceIds = getFavoriteWorkspaceIds(userId)
  const workIds = getFavoriteWorkItemIds(userId)
  const options: FavoriteOption[] = [
    ...overview.visibleNodes.filter((node) => !node.isDeleted).map((node) => ({ type: 'workspace' as const, id: String(node.id), name: node.name, path: `/workspace?nodeId=${node.id}` })),
    ...overview.visibleWorkItems.filter((item) => !item.isDeleted).map((item) => ({ type: 'work-item' as const, id: item.workItemId, name: item.title, path: `/work-items/${encodeURIComponent(item.workItemId)}` })),
  ]
  const isFavorite = (option: FavoriteOption) => option.type === 'workspace' ? workspaceIds.has(option.id) : workIds.includes(option.id)
  const favorites = options.filter(isFavorite)
  const candidates = options.filter((option) => option.type === category && option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  function toggle(option: FavoriteOption) {
    if (option.type === 'workspace') toggleFavoriteWorkspaceId(option.id, userId)
    else {
      toggleFavoriteWorkItem(option.id, userId)
    }
  }

  return (
    <section className={styles.workspaceList} aria-label="내 즐겨찾기">
      <div className={styles.workspaceListHeader}>
        <h2>내 즐겨찾기</h2>
        <button type="button" className={[styles.workspaceListAdd, styles.tooltipAnchor].join(' ')} data-tooltip="즐겨찾기 추가" onClick={() => { setQuery(''); setOpen(true) }}>
          <Icon name="plus" size={14} /><span className={styles.srOnly}>즐겨찾기 추가</span>
        </button>
      </div>
      <div className={styles.recentWorkItems}>
        {favorites.map((option) => (
          <Link key={`${option.type}:${option.id}`} to={option.path} className={styles.recentWorkItem}
            title={`${option.type === 'workspace' ? '워크스페이스' : '업무'}: ${option.name}`}
            onClick={() => { if (option.type === 'workspace') selectWorkspaceRoot(option.id, false, userId) }}>
            <span>#</span><strong>{option.name}</strong>
          </Link>
        ))}
        {favorites.length === 0 ? <p className={styles.recentWorkItemEmpty}>등록된 즐겨찾기가 없습니다.</p> : null}
      </div>
      {isOpen ? createPortal(
        <dialog ref={dialogRef} className={modalStyles.dialog} aria-labelledby="favorites-title" onCancel={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <div className={modalStyles.content}>
            <header className={modalStyles.header}><h2 id="favorites-title">즐겨찾기 추가</h2><button type="button" onClick={() => setOpen(false)} aria-label="닫기"><Icon name="close" size={18} /></button></header>
            <div className={modalStyles.filters}>
              <select aria-label="즐겨찾기 종류" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}><option value="workspace">워크스페이스</option><option value="work-item">업무</option></select>
              <input aria-label="즐겨찾기 검색" placeholder="이름 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className={modalStyles.list}>
              {candidates.map((option) => <label key={`${option.type}:${option.id}`} className={modalStyles.option}><input type="checkbox" checked={isFavorite(option)} onChange={() => toggle(option)} /><span>#{option.name}</span></label>)}
              {candidates.length === 0 ? <p>추가할 항목이 없습니다.</p> : null}
            </div>
          </div>
        </dialog>, document.body,
      ) : null}
    </section>
  )
}
