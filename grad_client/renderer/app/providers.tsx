import type { PropsWithChildren } from 'react'
import { ThemeProvider } from '../design-system/theme/ThemeProvider'
import {
  WorkspaceDataGate,
  WorkspaceDataProvider,
} from '../features/workspace/data/WorkspaceDataProvider'

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <WorkspaceDataProvider>
        <WorkspaceDataGate>{children}</WorkspaceDataGate>
      </WorkspaceDataProvider>
    </ThemeProvider>
  )
}
