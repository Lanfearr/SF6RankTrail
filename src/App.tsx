import { useEffect, useState } from 'react'
import type { ServerEvent } from '@shared/types'
import { MiniView } from './views/MiniView'
import { ProView } from './views/ProView'
import { useAppStore } from './store/useAppStore'

export default function App() {
  const [mode, setMode] = useState<'mini' | 'pro'>('mini')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const applyEvent = useAppStore((state) => state.applyEvent)
  const refresh = useAppStore((state) => state.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const socket = new WebSocket('ws://127.0.0.1:8765/ws')
    socket.addEventListener('message', (event) => {
      try {
        applyEvent(JSON.parse(String(event.data)) as ServerEvent)
      } catch {
        // ignore malformed frames
      }
    })
    return () => socket.close()
  }, [applyEvent])

  const switchMode = (next: 'mini' | 'pro'): void => {
    setMode(next)
    setAlwaysOnTop(next === 'mini')
    window.api.setWindowMode(next)
  }

  const toggleAlwaysOnTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    window.api.setAlwaysOnTop(next)
  }

  return (
    <div className={mode === 'pro' ? 'app pro-mode' : 'app'}>
      <header className="titlebar">
        <span className="brand">SF6 Scorer</span>
        <div className="titlebar-actions">
          <button
            className={mode === 'mini' ? 'chip active' : 'chip'}
            onClick={() => switchMode('mini')}
          >
            Mini
          </button>
          <button
            className={mode === 'pro' ? 'chip active' : 'chip'}
            onClick={() => switchMode('pro')}
          >
            Pro
          </button>
          <button className={alwaysOnTop ? 'chip active' : 'chip'} onClick={toggleAlwaysOnTop}>
            置顶
          </button>
          <button className="chip" onClick={() => window.close()}>
            关闭
          </button>
        </div>
      </header>

      {mode === 'mini' ? <MiniView /> : <ProView />}
    </div>
  )
}
