import { useMemo, useState } from 'react'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { useAppStore } from '../store/useAppStore'

export function MiniView() {
  const dashboards = useAppStore((state) => state.dashboards)
  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const setActive = useAppStore((state) => state.setActive)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const dashboard = useMemo(
    () =>
      dashboards.find((entry) => entry.player.shortId === activeShortId) ??
      dashboards[0] ??
      null,
    [dashboards, activeShortId]
  )

  const latest = dashboard?.latestMr ?? dashboard?.latestLp ?? null
  const kind = latest?.kind ?? null
  const session = dashboard?.session ?? null
  const delta = session ? (kind === 'LP' ? session.lpDelta : session.ratingDelta) : null
  const winRate =
    session && session.matches > 0
      ? Math.round((session.wins / session.matches) * 100)
      : null
  const running = sync.state === 'syncing'

  const run = async (action: () => Promise<unknown>, label: string): Promise<void> => {
    setBusy(true)
    setMessage(label)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const deltaClass =
    delta === null ? 'delta' : delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'
  const deltaLabel =
    delta === null || !kind
      ? '本会话 —'
      : `本会话 ${delta >= 0 ? '+' : ''}${delta} ${kind}`

  return (
    <div className="mini">
      {players.length > 1 && (
        <div className="pills">
          {players.map((player) => (
            <button
              key={player.shortId}
              className={player.shortId === dashboard?.player.shortId ? 'pill active' : 'pill'}
              onClick={() => setActive(player.shortId)}
            >
              {player.cfn ?? player.shortId}
            </button>
          ))}
        </div>
      )}

      {!dashboard ? (
        <div className="empty">
          <p>尚未追踪账号</p>
          <button
            className="chip active"
            disabled={busy}
            onClick={() => void run(login, '正在打开登录窗口…')}
          >
            登录 CAPCOM ID
          </button>
        </div>
      ) : (
        <>
          <div className="rating-card">
            <div className="rating-kind">{kind ?? '—'}</div>
            <AnimatedNumber className="rating-value" value={latest?.value ?? null} />
            <div className={deltaClass}>{deltaLabel}</div>
          </div>

          <div className="stats">
            <div>
              <span className="label">本会话</span>
              <span>{session ? `${session.wins}W ${session.losses}L` : '—'}</span>
            </div>
            <div>
              <span className="label">胜率</span>
              <span>{winRate !== null ? `${winRate}%` : '—'}</span>
            </div>
            <div>
              <span className="label">角色</span>
              <span>{latest?.character ?? '—'}</span>
            </div>
          </div>
        </>
      )}

      <div className="mini-footer">
        <span className="status">
          {sync.state}
          {sync.message ? ` · ${sync.message}` : ''}
        </span>
        <div className="actions">
          <button
            className="chip"
            disabled={busy}
            onClick={() => void run(login, '正在打开登录窗口…')}
          >
            登录
          </button>
          <button
            className="chip active"
            disabled={busy || running}
            onClick={() => void run(start, '同步启动中…')}
          >
            开始
          </button>
          <button
            className="chip"
            disabled={busy || !running}
            onClick={() => void run(stop, '正在停止…')}
          >
            停止
          </button>
        </div>
      </div>

      <div className="last-event">{message || lastEvent}</div>
    </div>
  )
}
