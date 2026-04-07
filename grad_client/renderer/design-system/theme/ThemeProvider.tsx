import { useEffect, useMemo, useState, type PropsWithChildren } from 'react'
import { ThemeContext, type ThemeContextValue, type ThemeMode } from './ThemeContext'

const THEME_STORAGE_KEY = 'grad-client-theme-mode'

function readInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedMode = window.localStorage.getItem(THEME_STORAGE_KEY)
  return storedMode === 'dark' || storedMode === 'light' ? storedMode : 'light'
}

function applyThemeMode(themeMode: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = themeMode
  document.documentElement.style.colorScheme = themeMode
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
      toggleTheme: () => setThemeMode((current) => (current === 'light' ? 'dark' : 'light')),
    }),
    [themeMode],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
