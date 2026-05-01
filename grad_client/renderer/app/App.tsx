import '../design-system/global/index.css'
import { AppProviders } from './providers'
import { AppRoutes } from './routes'

export default function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  )
}
