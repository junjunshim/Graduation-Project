// import { useState } from "react"

// function App() {
//   const [count, setCount] = useState(0)

//   return (
//     <div>
//       <h1>Hello Electron + React</h1>

//       <button onClick={() => setCount(count + 1)}>
//         count: {count}
//       </button>
//     </div>
//   )
// }

// export default App

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
