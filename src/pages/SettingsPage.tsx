import { useEffect, useMemo, useState } from 'react'
import type { ChartMode } from '@shared/types'
import { PageHeader } from '../components/Page'
import { useAppStore } from '../store/useAppStore'

export function SettingsPage() {
  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const setActive = useAppStore((state) => state.setActive)
  const addPlayer = useAppStore((state) => state.addPlayer)
  const removePlayer = useAppStore((state) => state.removePlayer)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)
  const refresh = useAppStore((state) => state.refresh)

  const [cfn, setCfn] = useState('')
  const [nickname, setNickname] = useState('')
  const [intervalMs, setIntervalMs] = useState('20000')
  const [chartMode, setChartMode] = useState<ChartMode>('mini')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const active = useMemo(
    () => players.find((player) => player.shortId === activeShortId) ?? null,
    [players, activeShortId]
  )
  const running = sync.state === 'syncing'

  useEffect(() => {
    void window.api.getSetting('syncIntervalMs').then((value) => {
      if (value) setIntervalMs(value)
    })
    void Promise.all([
      window.api.getSetting('chartMode'),
      window.api.getSetting('chartAlwaysOnTop')
    ]).then(([modeValue, topValue]) => {
      const nextMode = modeValue === 'pro' ? 'pro' : 'mini'
      setChartMode(nextMode)
      if (topValue === '1') setAlwaysOnTop(true)
      else if (topValue === '0') setAlwaysOnTop(false)
      else setAlwaysOnTop(nextMode === 'mini')
    })
    void window.api.getSetting('chartOpacity').then((value) => {
      const next = Number(value)
      if (Number.isFinite(next)) setOpacity(Math.min(1, Math.max(0.2, next)))
    })
  }, [])

  const run = async (action: () => Promise<unknown>, label?: string): Promise<void> => {
    setBusy(true)
    if (label) setMessage(label)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const submitPlayer = async (): Promise<void> => {
    const value = cfn.trim()
    if (!value) return
    await addPlayer(value, nickname.trim() || undefined)
    setCfn('')
    setNickname('')
    setMessage('账号已添加')
  }

  const applyInterval = async (): Promise<void> => {
    const value = Number(intervalMs)
    if (!Number.isFinite(value)) return
    await window.api.setSetting('syncIntervalMs', String(Math.max(15_000, Math.min(120_000, value))))
    await refresh()
    setMessage('同步间隔已保存')
  }

  const applyChartMode = (mode: ChartMode): void => {
    setChartMode(mode)
    window.api.chartSetMode(mode)
    void window.api.getSetting('chartAlwaysOnTop').then((value) => {
      if (value !== '1' && value !== '0') setAlwaysOnTop(mode === 'mini')
    })
  }

  const applyAlwaysOnTop = (value: boolean): void => {
    setAlwaysOnTop(value)
    window.api.chartSetAlwaysOnTop(value)
  }

  const applyOpacity = (value: number): void => {
    setOpacity(value)
    window.api.chartSetOpacity(value)
  }

  const overlayUrl = active
    ? `http://127.0.0.1:8765/overlay?player=${encodeURIComponent(
        active.cfn && active.cfn !== active.shortId ? active.cfn : active.shortId
      )}`
    : 'http://127.0.0.1:8765/overlay'

  return (
    <div className="page">
      <PageHeader title="设置" subtitle="账号、同步、图表窗口与 OBS 叠加层" />

      <div className="settings-grid">
        <section className="card">
          <div className="card-header">
            <h2>账号</h2>
            <span className="badge">{players.length} 个</span>
          </div>
          <div className="player-tags">
            {players.length === 0 && <span className="muted">暂无账号</span>}
            {players.map((player) => {
              const accountName =
                player.displayName ?? (player.cfn && player.cfn !== player.shortId ? player.cfn : null)
              const label = accountName ?? player.shortId
              return (
                <div
                  key={player.shortId}
                  className={player.shortId === activeShortId ? 'player-tag active' : 'player-tag'}
                  title={player.shortId}
                  onClick={() => setActive(player.shortId)}
                >
                  <button
                    type="button"
                    className="tag-remove"
                    title="删除账号"
                    aria-label={`删除 ${label}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      void run(() => removePlayer(player.shortId))
                    }}
                  >
                    ×
                  </button>
                  <span className="tag-name">{label}</span>
                  {accountName && <span className="tag-id">{player.shortId}</span>}
                </div>
              )
            })}
          </div>

          <div className="add-player">
            <input
              className="input"
              placeholder="CFN 或 short_id"
              value={cfn}
              onChange={(event) => setCfn(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitPlayer()
              }}
            />
            <div className="row">
              <input
                className="input"
                placeholder="昵称（可选）"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitPlayer()
                }}
              />
              <button className="btn" disabled={busy} onClick={() => void submitPlayer()}>
                添加
              </button>
            </div>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void run(login)}>
            登录 CAPCOM ID
          </button>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>同步</h2>
            <span className={running ? 'badge active' : 'badge'}>{sync.state}</span>
          </div>
          <p className="muted">{sync.message ?? '登录后自动开始同步'}</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy || running} onClick={() => void run(start)}>
              开始同步
            </button>
            <button className="btn" disabled={busy || !running} onClick={() => void run(stop)}>
              停止同步
            </button>
          </div>
          <div className="row">
            <label className="label">间隔 (ms)</label>
            <input
              className="input compact"
              value={intervalMs}
              onChange={(event) => setIntervalMs(event.target.value)}
            />
            <button className="btn" onClick={() => void applyInterval()}>
              应用
            </button>
          </div>
          <span className="muted small">允许范围 15000–120000 ms</span>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>图表窗口</h2>
            <button className="btn" onClick={() => window.api.openChart()}>
              打开图表
            </button>
          </div>
          <div className="row">
            <label className="label">默认模式</label>
            <select
              className="select"
              value={chartMode}
              onChange={(event) => applyChartMode(event.target.value as ChartMode)}
            >
              <option value="mini">Mini</option>
              <option value="pro">Pro（最近 20 场）</option>
            </select>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={alwaysOnTop}
              onChange={(event) => applyAlwaysOnTop(event.target.checked)}
            />
            <span>图表窗口置顶</span>
          </label>
          <div className="row">
            <label className="label">不透明度</label>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => applyOpacity(Number(event.target.value))}
            />
            <span className="muted">{Math.round(opacity * 100)}%</span>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>OBS 叠加层</h2>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(overlayUrl)
                setMessage('叠加层地址已复制')
              }}
            >
              复制地址
            </button>
          </div>
          <code className="overlay-url">{overlayUrl}</code>
          <p className="muted small">
            将地址添加为 OBS 浏览器源。使用 player 参数锁定当前账号；也可以省略参数自动跟随主账号。
          </p>
        </section>
      </div>

      {message && <div className="toast">{message}</div>}
    </div>
  )
}
