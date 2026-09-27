import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './demo/App'
import './demo/App.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
