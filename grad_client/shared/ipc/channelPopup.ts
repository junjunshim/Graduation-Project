export const CHANNEL_POPUP_CHANNELS = {
  open: 'channel-popup:open',
  channelChanged: 'channel-popup:channel-changed',
} as const

export type ChannelPopupApi = {
  open: (channelId: number) => Promise<boolean>
  onChannelChange: (listener: (channelId: number) => void) => VoidFunction
}
