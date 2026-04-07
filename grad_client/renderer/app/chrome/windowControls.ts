export type { WindowControlsApi } from '../../../electron/ipc/windowControls'

export function hasCustomWindowControls() {
  return typeof window !== 'undefined' && typeof window.windowControls !== 'undefined'
}
