import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Button } from '../../design-system/primitives/Button'
import { Icon, type IconName } from '../../design-system/primitives/Icon'
import { SearchField } from '../../design-system/primitives/SearchField'
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

// 사이드바 목록과 추가 팝업에서 같은 기준으로 워크스페이스/업무를 구분한다.
const FAVORITE_GROUPS: Array<{ type: 'workspace' | 'work-item'; label: string; icon: IconName }> = [
  { type: 'workspace', label: '워크스페이스', icon: 'building' },
  { type: 'work-item', label: '업무', icon: 'page' },
]


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
  const favoriteGroups = FAVORITE_GROUPS.map((group) => ({
    ...group,
    items: favorites.filter((option) => option.type === group.type),
  }))
  const candidates = options
    .filter((option) => option.type === category && option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    // 이미 즐겨찾기한 항목을 위로 올리고, 같은 상태끼리는 이름순으로 정렬한다.
    .sort((a, b) => Number(isFavorite(b)) - Number(isFavorite(a)) || a.name.localeCompare(b.name, 'ko'))

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
      <div className={styles.recentWorkItems} role="region" aria-label="즐겨찾기 목록" tabIndex={0}>
        {favorites.length === 0 ? (
          <p className={styles.recentWorkItemEmpty}>등록된 즐겨찾기가 없습니다.</p>
        ) : (
          favoriteGroups.map((group) => (
            group.items.length === 0 ? null : (
              <div key={group.type} className={styles.favoriteGroup}>
                <h3 className={styles.favoriteGroupTitle}>
                  <Icon name={group.icon} size={13} className={styles.favoriteGroupIcon} />
                  <span>{group.label}</span>
                  <span className={styles.favoriteGroupCount}>{group.items.length}</span>
                </h3>
                {group.items.map((option) => (
                  <Link key={`${option.type}:${option.id}`} to={option.path} className={styles.recentWorkItem}
                    title={`${group.label}: ${option.name}`}
                    onClick={() => { if (option.type === 'workspace') selectWorkspaceRoot(option.id, false, userId) }}>
                    <span className={styles.recentWorkItemIcon}><Icon name={group.icon} size={14} /></span><strong>{option.name}</strong>
                  </Link>
                ))}
              </div>
            )
          ))
        )}
      </div>
      {isOpen ? createPortal(
        <dialog ref={dialogRef} className={modalStyles.dialog} aria-labelledby="favorites-title" onCancel={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}>
          <div className={modalStyles.content}>
            <header className={modalStyles.header}>
              <div className={modalStyles.titleGroup}>
                <span className={modalStyles.titleIcon}><Icon name="star" size={15} /></span>
                <h2 id="favorites-title" className={modalStyles.title}>즐겨찾기 추가</h2>
              </div>
              <button type="button" className={modalStyles.closeButton} onClick={() => setOpen(false)} aria-label="닫기">
                <Icon name="close" size={16} />
              </button>
            </header>

            <div className={modalStyles.tabs} role="group" aria-label="즐겨찾기 종류">
              {FAVORITE_GROUPS.map((tab) => {
                const isActive = category === tab.type
                const favoriteCount = options.filter((option) => option.type === tab.type && isFavorite(option)).length

                return (
                  <button
                    key={tab.type}
                    type="button"
                    className={modalStyles.tab}
                    data-active={isActive ? 'true' : undefined}
                    aria-pressed={isActive}
                    onClick={() => setCategory(tab.type)}
                  >
                    <Icon name={tab.icon} size={15} />
                    <span>{tab.label}</span>
                    {favoriteCount > 0 ? <span className={modalStyles.tabCount}>{favoriteCount}</span> : null}
                  </button>
                )
              })}
            </div>

            <SearchField
              label="즐겨찾기 검색"
              placeholder={`${category === 'workspace' ? '워크스페이스' : '업무'} 이름 검색`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              containerClassName={modalStyles.search}
            />

            <div className={modalStyles.list} role="group" aria-label="즐겨찾기 후보">
              {candidates.map((option) => {
                const isOptionFavorite = isFavorite(option)

                return (
                  <div
                    key={`${option.type}:${option.id}`}
                    className={modalStyles.option}
                    data-favorite={isOptionFavorite ? 'true' : undefined}
                  >
                    <Icon
                      name={option.type === 'workspace' ? 'building' : 'page'}
                      size={15}
                      className={modalStyles.optionIcon}
                    />
                    <span className={modalStyles.optionName}>{option.name}</span>
                    {/* 별표만 클릭 대상으로 두어 목록 영역 클릭으로는 토글되지 않는다. */}
                    <button
                      type="button"
                      className={modalStyles.optionStar}
                      aria-pressed={isOptionFavorite}
                      aria-label={`${option.name} ${isOptionFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}`}
                      title={isOptionFavorite ? '즐겨찾기 해제' : '즐겨찾기 추가'}
                      onClick={() => toggle(option)}
                    >
                      <Icon name="star" size={15} fill={isOptionFavorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                )
              })}
              {candidates.length === 0 ? <p className={modalStyles.empty}>추가할 항목이 없습니다.</p> : null}
            </div>

            <footer className={modalStyles.footer}>
              <span className={modalStyles.footerHint}>별표를 누르면 바로 추가되거나 해제됩니다.</span>
              <Button variant="secondary" onClick={() => setOpen(false)}>닫기</Button>
            </footer>
          </div>
        </dialog>, document.body,
      ) : null}
    </section>
  )
}