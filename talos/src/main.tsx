import {createRoot} from 'react-dom/client'
import App from './App.tsx'

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
createRoot(document.getElementById('root')).render(
  <App/>
)
