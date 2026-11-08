import { useEffect, useMemo, useState } from 'react'
import type { RatingKind } from '@shared/types'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { useAppStore } from '../store/useAppStore'

export function MiniView() {
  const dashboards = useAppStore((state) => state.dashboards)
  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const setActive = useAppStore((state) => state.setActive)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const refreshSession = useAppStore((state) => state.refreshSession)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)

  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<RatingKind | null>(null)

  const dashboard = useMemo(
    () =>
      dashboards.find((entry) => entry.player.shortId === activeShortId) ?? dashboards[0] ?? null,
    [dashboards, activeShortId]
  )

  const activeKind: RatingKind = kind ?? (dashboard?.latestMr ? 'MR' : dashboard?.latestLp ? 'LP' : 'MR')
  const latest = activeKind === 'MR' ? dashboard?.latestMr : dashboard?.latestLp
  const session = dashboard?.session ?? null
  const delta = session ? (activeKind === 'LP' ? session.lpDelta : session.ratingDelta) : null
  const winRate =
    session && session.matches > 0 ? Math.round((session.wins / session.matches) * 100) : null
  const running = sync.state === 'syncing'

  useEffect(() => {
    void window.api.getSetting('miniKind').then((value) => {
      if (value === 'MR' || value === 'LP') setKind(value)
    })
  }, [])

  const run = async (action: () => Promise<unknown>, label: string): Promise<void> => {
    setBusy(true)
    setMessage(label)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const chooseKind = (next: RatingKind): void => {
    setKind(next)
    void window.api.setSetting('miniKind', next)
  }

  const deltaClass =
    delta === null ? 'delta' : delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'
  const deltaLabel = delta === null ? '本会话 —' : `本会话 ${delta >= 0 ? '+' : ''}${delta} ${activeKind}`

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
              {player.displayName ?? player.cfn ?? player.shortId}
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
            <div className="rating-tabs">
              {(['MR', 'LP'] as const).map((value) => (
                <button
                  key={value}
                  className={activeKind === value ? 'pill active' : 'pill'}
                  onClick={() => chooseKind(value)}
                >
                  {value}
                </button>
              ))}
            </div>
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
            className="chip"
            disabled={busy || !dashboard}
            onClick={() =>
              dashboard &&
              void run(
                () => refreshSession(dashboard.player.shortId),
                '正在开始新的本次会话…'
              )
            }
          >
            刷新
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
