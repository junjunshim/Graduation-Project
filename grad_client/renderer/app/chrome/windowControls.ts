import type { WindowControlsApi } from '../../../shared/ipc/windowControls'

export type { WindowControlsApi }

export function getWindowControls(): WindowControlsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.windowControls ?? null
}

export function hasCustomWindowControls() {
  return getWindowControls() !== null
}
