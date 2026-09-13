import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { ThemeContext, type ThemeContextValue, type ThemeMode } from './ThemeContext'

const THEME_STORAGE_KEY = 'grad-client-theme-mode'

function readInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'beige'
  }

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedMode === 'white' || storedMode === 'beige' || storedMode === 'dark' || storedMode === 'navy') {
    return storedMode
  }
  // 이전 레거시 'light'는 현재의 기본인 'beige'로 매핑
  return 'beige'
}

function applyThemeMode(themeMode: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = themeMode
  document.documentElement.style.colorScheme = themeMode === 'dark' || themeMode === 'navy' ? 'dark' : 'light'
  document.body.dataset.theme = themeMode
  document.getElementById('root')?.setAttribute('data-theme', themeMode)
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(readInitialThemeMode)

  useEffect(() => {
    applyThemeMode(themeMode)

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
    }
  }, [themeMode])

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      setThemeMode,
      toggleTheme: () =>
        setThemeMode((current) => {
          if (current === 'white') return 'beige'
          if (current === 'beige') return 'navy'
          if (current === 'navy') return 'dark'
          return 'white'
        }),
    }),
    [themeMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
