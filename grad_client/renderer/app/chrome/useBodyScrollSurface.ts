import { useEffect } from 'react'

type ScrollSurface = 'workspace' | 'auth'

export function useBodyScrollSurface(surface?: ScrollSurface) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const { body } = document
    const previousSurface = body.dataset.scrollSurface

    if (surface) {
      body.dataset.scrollSurface = surface
    } else {
      delete body.dataset.scrollSurface
    }

    return () => {
      if (previousSurface) {
        body.dataset.scrollSurface = previousSurface
        return
      }

      if (body.dataset.scrollSurface === surface) {
        delete body.dataset.scrollSurface
      }
    }
  }, [surface])
}
