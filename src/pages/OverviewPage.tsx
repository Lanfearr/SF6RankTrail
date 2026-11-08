import { useEffect, useMemo, useState } from 'react'
import type { Match } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'
import { useAppStore } from '../store/useAppStore'

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString()}`

const tone = (value: number | null): 'up' | 'down' | undefined =>
  value === null ? undefined : value > 0 ? 'up' : value < 0 ? 'down' : undefined

export function OverviewPage() {
  const players = useAppStore((state) => state.players)
  const dashboards = useAppStore((state) => state.dashboards)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)
  const refreshSession = useAppStore((state) => state.refreshSession)

  const [recent, setRecent] = useState<Match[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const dashboard = useMemo(
    () => dashboards.find((entry) => entry.player.shortId === activeShortId) ?? null,
    [dashboards, activeShortId]
  )
  const shortId = dashboard?.player.shortId ?? null
  const session = dashboard?.session ?? null
  const running = sync.state === 'syncing'
  const winRate =
    session && session.matches > 0 ? Math.round((session.wins / session.matches) * 100) : null

  useEffect(() => {
    if (!shortId) {
      setRecent([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api
      .listMatches({ shortId, limit: 6 })
      .then((matches) => {
        if (!cancelled) setRecent(matches)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="概览"
        subtitle={dashboard ? `${dashboard.player.displayName ?? dashboard.player.cfn ?? dashboard.player.shortId} · ${dashboard.player.shortId}` : '尚未选择账号'}
        actions={
          <>
            <button className="btn" onClick={() => window.api.openChart()}>
              打开图表窗口
            </button>
            <button
              className="btn"
              disabled={busy || !shortId}
              onClick={() => shortId && void run(() => refreshSession(shortId))}
            >
              刷新本次会话
            </button>
          </>
        }
      />

      {!dashboard ? (
        <EmptyState
          title="尚未追踪账号"
          detail="先完成 CAPCOM ID 登录，或在设置中添加 CFN / short_id。"
          action={
            <button className="btn primary" disabled={busy} onClick={() => void run(login)}>
              登录 CAPCOM ID
            </button>
          }
        />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label={`当前 MR${dashboard.latestMr?.character ? ` · ${dashboard.latestMr.character}` : ''}`}
              value={dashboard.latestMr?.value.toLocaleString() ?? '—'}
              detail={dashboard.latestMr ? new Date(dashboard.latestMr.observedAt).toLocaleString() : '暂无数据'}
            />
            <StatCard
              label={`当前 LP${dashboard.latestLp?.character ? ` · ${dashboard.latestLp.character}` : ''}`}
              value={dashboard.latestLp?.value.toLocaleString() ?? '—'}
              detail={dashboard.latestLp ? new Date(dashboard.latestLp.observedAt).toLocaleString() : '暂无数据'}
            />
            <StatCard
              label="本会话 MR 净上分"
              value={signed(session?.ratingDelta ?? null)}
              tone={tone(session?.ratingDelta ?? null)}
              detail={session ? `${session.matches} 场 · ${session.wins}W ${session.losses}L${winRate !== null ? ` · 胜率 ${winRate}%` : ''}` : '尚未开始'}
            />
            <StatCard
              label="本会话 LP 净上分"
              value={signed(session?.lpDelta ?? null)}
              tone={tone(session?.lpDelta ?? null)}
              detail={session?.startedAt ? `开始于 ${new Date(session.startedAt).toLocaleString()}` : '尚未开始'}
            />
          </div>

          <div className="two-column">
            <section className="card">
              <div className="card-header">
                <h2>同步状态</h2>
                <span className={running ? 'badge active' : 'badge'}>{sync.state}</span>
              </div>
              <p className="muted">{sync.message ?? lastEvent}</p>
              <div className="button-row">
                <button className="btn" disabled={busy} onClick={() => void run(login)}>
                  重新登录
                </button>
                <button className="btn primary" disabled={busy || running} onClick={() => void run(start)}>
                  开始同步
                </button>
                <button className="btn" disabled={busy || !running} onClick={() => void run(stop)}>
                  停止同步
                </button>
              </div>
              <div className="kv-list">
                <div>
                  <span>追踪账号</span>
                  <strong>{players.length}</strong>
                </div>
                <div>
                  <span>当前账号</span>
                  <strong>{dashboard.player.displayName ?? dashboard.player.cfn ?? dashboard.player.shortId}</strong>
                </div>
                <div>
                  <span>最近事件</span>
                  <strong>{lastEvent}</strong>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2>最近对局</h2>
                <span className="muted">{loading ? '加载中…' : '最新 6 场'}</span>
              </div>
              {loading ? (
                <LoadingBlock />
              ) : recent.length === 0 ? (
                <EmptyState title="暂无对局" />
              ) : (
                <ul className="recent-list">
                  {recent.map((match) => (
                    <li key={match.replayId}>
                      <CharacterIcon name={match.oppChar} result={match.result} />
                      <span className={`result ${match.result}`}>
                        {match.result === 'win' ? '胜' : match.result === 'loss' ? '负' : '平'}
                      </span>
                      <span className="match-characters">
                        {match.myChar ?? '?'} vs {match.oppChar ?? '?'}
                      </span>
                      <span className="muted">{new Date(match.playedAt).toLocaleString()}</span>
                      <strong>{match.myMr ?? match.myLp ?? '—'}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
