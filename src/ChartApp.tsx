import { useEffect, useState } from 'react'
import type { ChartMode } from '@shared/types'
import { useRealtime } from './lib/useRealtime'
import { MiniView } from './views/MiniView'
import { ProView } from './views/ProView'

export function ChartApp() {
  const [mode, setMode] = useState<ChartMode>('mini')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)

  useRealtime()

  useEffect(() => {
    void Promise.all([
      window.api.getSetting('chartMode'),
      window.api.getSetting('chartAlwaysOnTop')
    ]).then(([modeValue, topValue]) => {
      const nextMode = modeValue === 'pro' ? 'pro' : 'mini'
      setMode(nextMode)
      if (topValue === '1') setAlwaysOnTop(true)
      else if (topValue === '0') setAlwaysOnTop(false)
      else setAlwaysOnTop(nextMode === 'mini')
    })
    const offMode = window.api.onChartModeChanged(setMode)
    const offTop = window.api.onChartAlwaysOnTopChanged(setAlwaysOnTop)
    return () => {
      offMode()
      offTop()
    }
  }, [])

  const switchMode = (next: ChartMode): void => {
    setMode(next)
    window.api.chartSetMode(next)
    void window.api.getSetting('chartAlwaysOnTop').then((value) => {
      if (value === '1') setAlwaysOnTop(true)
      else if (value === '0') setAlwaysOnTop(false)
      else setAlwaysOnTop(next === 'mini')
    })
  }

  const toggleAlwaysOnTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    window.api.chartSetAlwaysOnTop(next)
  }

  return (
    <div className={mode === 'pro' ? 'app pro-mode' : 'app'}>
      <header className="titlebar">
        <span className="brand">SF6 RankTrail</span>
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
          <button className="chip" onClick={() => window.api.closeChart()}>
            关闭
          </button>
        </div>
      </header>

      {mode === 'mini' ? <MiniView /> : <ProView />}
    </div>
  )
}
