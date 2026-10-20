import { useMemo, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { SearchField } from '../../../design-system/primitives/SearchField'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { DmChannelItem, WorkspaceChannelItem } from '../model/channelTypes'
import { getNodeVisualMetadata } from '../../workspace/queries/workspaceDirectory'
import styles from './ChannelSidebar.module.css'

export type WorkspaceGroup = {
  nodeId: number
  nodeName: string
  nodeType?: string
  canManage: boolean
  channels: WorkspaceChannelItem[]
}

export type ChannelSidebarProps = {
  workspaceGroups: WorkspaceGroup[]
  dmChannels: DmChannelItem[]
  selectedChannelId: number | null
  onSelectChannel: (channelId: number) => void
  onOpenCreateChannelModal: (nodeId: number, nodeName: string) => void
  onOpenNewDmModal: () => void
}

export function ChannelSidebar({
  workspaceGroups,
  dmChannels,
  selectedChannelId,
  onSelectChannel,
  onOpenCreateChannelModal,
  onOpenNewDmModal,
}: ChannelSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  // 처음 진입할 때는 모든 워크스페이스 채널 그룹을 접힌 상태로 둔다.
  const [expandedNodes, setExpandedNodes] = useState<Record<number, boolean>>({})

  const normalizedQuery = searchQuery.trim().toLowerCase()

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return workspaceGroups

    return workspaceGroups
      .map((group) => {
        const nodeMatches = group.nodeName.toLowerCase().includes(normalizedQuery)
        const matchingChannels = group.channels.filter(
          (ch) =>
            nodeMatches ||
            ch.name.toLowerCase().includes(normalizedQuery) ||
            ch.description.toLowerCase().includes(normalizedQuery),
        )
        return {
          ...group,
          channels: matchingChannels,
        }
      })
      .filter((group) => group.channels.length > 0 || group.nodeName.toLowerCase().includes(normalizedQuery))
  }, [workspaceGroups, normalizedQuery])

  const filteredDms = useMemo(() => {
    if (!normalizedQuery) return dmChannels

    return dmChannels.filter(
      (dm) =>
        dm.counterpartName.toLowerCase().includes(normalizedQuery) ||
        dm.counterpartEmail.toLowerCase().includes(normalizedQuery),
    )
  }, [dmChannels, normalizedQuery])

  function toggleNodeExpansion(nodeId: number) {
    setExpandedNodes((prev) => ({
      ...prev,
      [nodeId]: !prev[nodeId],
    }))
  }

  return (
    <aside className={styles.sidebar} aria-label="채널 및 다이렉트 메시지 목록">
      <div className={styles.searchSection}>
        <SearchField
          label="채널 또는 대화 상대 검색"
          placeholder="채널 또는 대화 상대 검색"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <div className={styles.scrollArea}>
        {/* 워크스페이스 채널 섹션 */}
        <section className={styles.section} aria-label="워크스페이스 채널">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>워크스페이스 채널</span>
          </div>

          {filteredGroups.length === 0 ? (
            <p className={styles.emptyHint}>표시할 워크스페이스 채널이 없습니다.</p>
          ) : (
            <div className={styles.groupList}>
              {filteredGroups.map((group) => {
                const isCollapsed = !expandedNodes[group.nodeId] && !normalizedQuery
                const groupUnread = group.channels.reduce((sum, ch) => sum + ch.unreadCount, 0)

                return (
                  <div key={group.nodeId} className={styles.workspaceGroup}>
                    <div className={styles.groupHeaderRow}>
                      <button
                        type="button"
                        className={styles.groupToggleButton}
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleNodeExpansion(group.nodeId)}
                      >
                        <Icon
                          name={isCollapsed ? 'chevronRight' : 'chevronDown'}
                          size={14}
                          className={styles.groupChevron}
                        />
                        <Icon
                          name={getNodeVisualMetadata(group.nodeType ?? '').iconName}
                          size={14}
                          className={styles.groupBuildingIcon}
                        />
                        <span className={styles.groupName} title={group.nodeName}>
                          {group.nodeName}
                        </span>
                        {isCollapsed && groupUnread > 0 ? (
                          <span className={styles.unreadBadge}>{groupUnread}</span>
                        ) : null}
                      </button>

                      {group.canManage ? (
                        <button
                          type="button"
                          className={styles.groupAddButton}
                          title={`${group.nodeName}에 새 채널 추가`}
                          aria-label={`${group.nodeName}에 새 채널 추가`}
                          onClick={() => onOpenCreateChannelModal(group.nodeId, group.nodeName)}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                      ) : null}
                    </div>

                    {!isCollapsed ? (
                      <ul className={styles.channelList}>
                        {group.channels.map((channel) => {
                          const isSelected = channel.channelId === selectedChannelId
                          const hasUnread = channel.unreadCount > 0 && !isSelected

                          return (
                            <li key={channel.channelId}>
                              <button
                                type="button"
                                className={styles.channelItem}
                                data-selected={isSelected ? 'true' : undefined}
                                data-unread={hasUnread ? 'true' : undefined}
                                onClick={() => onSelectChannel(channel.channelId)}
                              >
                                <span className={styles.hashPrefix} aria-hidden="true">
                                  #
                                </span>
                                <span className={styles.channelName} title={channel.name}>
                                  {channel.name}
                                </span>
                                {hasUnread ? (
                                  <span className={styles.unreadBadge}>
                                    {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <hr className={styles.divider} />

        {/* 1:1 다이렉트 메시지 섹션 */}
        <section className={styles.section} aria-label="다이렉트 메시지">
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>다이렉트 메시지 (1:1)</span>
            <button
              type="button"
              className={styles.sectionActionButton}
              title="이메일로 새 1:1 대화 시작"
              aria-label="이메일로 새 1:1 대화 시작"
              onClick={onOpenNewDmModal}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>

          {filteredDms.length === 0 ? (
            <p className={styles.emptyHint}>진행 중인 1:1 대화가 없습니다.</p>
          ) : (
            <ul className={styles.dmList}>
              {filteredDms.map((dm) => {
                const isSelected = dm.channelId === selectedChannelId
                const hasUnread = dm.unreadCount > 0 && !isSelected

                return (
                  <li key={dm.channelId}>
                    <button
                      type="button"
                      className={styles.dmItem}
                      data-selected={isSelected ? 'true' : undefined}
                      data-unread={hasUnread ? 'true' : undefined}
                      onClick={() => onSelectChannel(dm.channelId)}
                    >
                      <UserAvatar
                        name={dm.counterpartName}
                        userId={dm.counterpartUserId || dm.counterpartEmail}
                        size="small"
                      />
                      <div className={styles.dmInfo}>
                        <span className={styles.dmName} title={dm.counterpartName}>
                          {dm.counterpartName}
                        </span>
                        <span className={styles.dmEmail} title={dm.counterpartEmail}>
                          {dm.counterpartEmail}
                        </span>
                      </div>
                      {hasUnread ? (
                        <span className={styles.unreadBadge}>
                          {dm.unreadCount > 99 ? '99+' : dm.unreadCount}
                        </span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <button
            type="button"
            className={styles.startDmWideButton}
            onClick={onOpenNewDmModal}
          >
            <Icon name="mail" size={15} />
            <span>이메일로 새 대화 시작</span>
          </button>
        </section>
      </div>
    </aside>
  )
}
