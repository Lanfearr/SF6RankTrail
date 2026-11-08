import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ChartApp } from './ChartApp'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ChartApp />
  </StrictMode>
)
