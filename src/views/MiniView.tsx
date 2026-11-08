import { useEffect, useMemo, useState } from 'react'
import type { RatingKind } from '@shared/types'
import { AnimatedNumber } from '../components/AnimatedNumber'
import { useAppStore } from '../store/useAppStore'

export function MiniView() {
  const dashboards = useAppStore((state) => state.dashboards)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const refreshSession = useAppStore((state) => state.refreshSession)

  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    void window.api.getSetting('miniKind').then((value) => {
      if (value === 'MR' || value === 'LP') setKind(value)
    })
  }, [])

  const chooseKind = (next: RatingKind): void => {
    setKind(next)
    void window.api.setSetting('miniKind', next)
  }

  const deltaClass =
    delta === null ? 'delta' : delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'
  const deltaLabel = delta === null ? '本会话 —' : `本会话 ${delta >= 0 ? '+' : ''}${delta} ${activeKind}`

  return (
    <div className="mini">
      <div className="chart-account">
        <span className="label">账号</span>
        <span title={dashboard?.player.shortId}>
          {dashboard?.player.displayName ?? dashboard?.player.cfn ?? dashboard?.player.shortId ?? '未选择'}
        </span>
      </div>

      {!dashboard ? (
        <div className="empty">
          <p>请先在主窗口添加账号</p>
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
            disabled={busy || !dashboard}
            onClick={() => {
              if (!dashboard) return
              setBusy(true)
              void refreshSession(dashboard.player.shortId).finally(() => setBusy(false))
            }}
          >
            刷新
          </button>
        </div>
      </div>

      <div className="last-event">{lastEvent}</div>
    </div>
  )
}
