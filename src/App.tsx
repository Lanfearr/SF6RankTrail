import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Player, ServerEvent, SyncStatus } from '@shared/types'

export default function App() {
  const [players, setPlayers] = useState<Player[]>([])
  const [cfn, setCfn] = useState('')
  const [message, setMessage] = useState('就绪')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [sync, setSync] = useState<SyncStatus>({ state: 'idle', at: Date.now() })
  const [busy, setBusy] = useState(false)

  const self = useMemo(() => players.find((player) => player.isSelf) ?? null, [players])
  const running = sync.state === 'syncing'

  const refresh = useCallback(async () => {
    const list = await window.api.listPlayers()
    setPlayers(list)
    const status = await window.api.syncStatus()
    setSync(status)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const socket = new WebSocket('ws://127.0.0.1:8765/ws')
    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data) as ServerEvent
        if (data.type === 'snapshot') {
          setPlayers(data.payload.players)
          setSync(data.payload.sync)
        } else if (data.type === 'sync:status') {
          setSync(data.payload)
        } else if (data.type === 'match:new') {
          const result = data.payload.result === 'win' ? '胜' : data.payload.result === 'loss' ? '负' : '平'
          setMessage(`新对局：${result} · ${data.payload.myChar ?? '?'}`)
        } else if (data.type === 'session:update') {
          const delta = data.payload.ratingDelta
          const sign = delta !== null && delta >= 0 ? '+' : ''
          setMessage(
            `本会话 ${data.payload.wins}胜${data.payload.losses}负` +
              (delta !== null ? ` · ${sign}${delta} MR` : '')
          )
        }
      } catch {
        // ignore malformed events
      }
    })
    return () => socket.close()
  }, [])

  const login = async (): Promise<void> => {
    setBusy(true)
    setMessage('正在打开登录窗口…')
    const result = await window.api.authLogin({})
    setMessage(result.message ?? '登录流程已启动')
    setBusy(false)
  }

  const start = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.syncStart()
    setMessage(result.ok ? `同步已启动（${result.players} 个账号）` : (result.message ?? '启动失败'))
    setBusy(false)
    await refresh()
  }

  const stop = async (): Promise<void> => {
    setBusy(true)
    await window.api.syncStop()
    setMessage('同步已停止')
    setBusy(false)
    await refresh()
  }

  const addPlayer = async (): Promise<void> => {
    const value = cfn.trim()
    if (!value) return
    const player = await window.api.addPlayer({ cfn: value })
    setMessage(player ? `已添加 ${player.cfn ?? player.shortId}` : '添加失败')
    setCfn('')
    await refresh()
  }

  const toggleTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    window.api.setAlwaysOnTop(next)
  }

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand">SF6 Scorer</span>
        <div className="titlebar-actions">
          <button className={alwaysOnTop ? 'chip active' : 'chip'} onClick={toggleTop}>
            置顶
          </button>
          <button className="chip" onClick={() => window.close()}>
            关闭
          </button>
        </div>
      </header>

      <section className="panel">
        <div className="row">
          <span className="label">当前账号</span>
          <span className="value">{self ? (self.cfn ?? self.shortId) : '未登录'}</span>
        </div>
        <div className="row">
          <span className="label">同步状态</span>
          <span className={running ? 'value small accent' : 'value small'}>{sync.state}</span>
        </div>
        <div className="row">
          <span className="label">信息</span>
          <span className="value small">{message}</span>
        </div>
        <div className="row actions">
          <button className="chip active" disabled={busy} onClick={() => void login()}>
            登录
          </button>
          <button className="chip" disabled={busy || running} onClick={() => void start()}>
            开始
          </button>
          <button className="chip" disabled={busy || !running} onClick={() => void stop()}>
            停止
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="row">
          <input
            className="input"
            placeholder="输入 CFN / short_id"
            value={cfn}
            onChange={(event) => setCfn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void addPlayer()
            }}
          />
          <button className="chip active" onClick={() => void addPlayer()}>
            添加
          </button>
        </div>
        <ul className="players">
          {players.length === 0 && <li className="muted">暂无追踪账号</li>}
          {players.map((player) => (
            <li key={player.shortId}>
              <span>{player.cfn ?? player.shortId}</span>
              <span className="muted">{player.isSelf ? '自己' : '他人'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
