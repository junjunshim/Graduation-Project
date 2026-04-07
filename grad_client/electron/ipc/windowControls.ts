export const WINDOW_CONTROL_CHANNELS = {
  close: 'window-controls:close',
  isMaximized: 'window-controls:is-maximized',
  maximizeChanged: 'window-controls:maximize-changed',
  minimize: 'window-controls:minimize',
  toggleMaximize: 'window-controls:toggle-maximize',
} as const

export type WindowControlsApi = {
  minimize: () => void
  toggleMaximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  onMaximizeChange: (listener: (isMaximized: boolean) => void) => VoidFunction
}
