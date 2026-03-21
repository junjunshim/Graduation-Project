import type { PropsWithChildren } from 'react'
import { ThemeProvider } from '../design-system/theme/ThemeProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return <ThemeProvider>{children}</ThemeProvider>
}
