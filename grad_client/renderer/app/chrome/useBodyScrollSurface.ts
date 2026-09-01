import { useEffect } from 'react'

type ScrollSurface = 'workspace' | 'auth'

export function useBodyScrollSurface(surface?: ScrollSurface) {
  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const { body, documentElement } = document
    const previousBodySurface = body.dataset.scrollSurface
    const previousRootSurface = documentElement.dataset.scrollSurface

    if (surface) {
      body.dataset.scrollSurface = surface
      documentElement.dataset.scrollSurface = surface
    } else {
      delete body.dataset.scrollSurface
      delete documentElement.dataset.scrollSurface
    }

    return () => {
      if (previousBodySurface) {
        body.dataset.scrollSurface = previousBodySurface
      } else if (body.dataset.scrollSurface === surface) {
        delete body.dataset.scrollSurface
      }

      if (previousRootSurface) {
        documentElement.dataset.scrollSurface = previousRootSurface
      } else if (documentElement.dataset.scrollSurface === surface) {
        delete documentElement.dataset.scrollSurface
      }
    }
  }, [surface])
}
