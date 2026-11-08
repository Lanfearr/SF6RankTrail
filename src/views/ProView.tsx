import { useEffect, useMemo, useState } from 'react'
import type { Match, RatingKind, RatingPoint } from '@shared/types'
import { TrendChart } from '../components/TrendChart'
import { buildRatingDeltas } from '../lib/ratings'
import { useAppStore } from '../store/useAppStore'

const RECENT_MATCH_LIMIT = 20

export function ProView() {
  const dashboards = useAppStore((state) => state.dashboards)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const refreshSession = useAppStore((state) => state.refreshSession)

  const [kind, setKind] = useState<RatingKind>('MR')
  const [character, setCharacter] = useState<string | null>(null)
  const [points, setPoints] = useState<RatingPoint[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [busy, setBusy] = useState(false)

  const dashboard = useMemo(
    () =>
      dashboards.find((entry) => entry.player.shortId === activeShortId) ?? dashboards[0] ?? null,
    [dashboards, activeShortId]
  )
  const shortId = dashboard?.player.shortId ?? null

  useEffect(() => {
    if (!shortId) {
      setPoints([])
      setMatches([])
      return
    }

    let cancelled = false
    void (async () => {
      const [series, recent] = await Promise.all([
        window.api.ratingSeries({ shortId, kind }),
        window.api.listMatches({ shortId, limit: 100 })
      ])
      if (!cancelled) {
        setPoints(series)
        setMatches(recent)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [shortId, kind, lastEvent])

  useEffect(() => {
    setCharacter(null)
  }, [shortId])

  const recentMatches = useMemo(() => matches.slice(0, RECENT_MATCH_LIMIT), [matches])
  const windowStart =
    recentMatches.length === RECENT_MATCH_LIMIT
      ? (recentMatches[recentMatches.length - 1]?.playedAt ?? null)
      : null

  const windowPoints = useMemo(
    () =>
      windowStart === null
        ? points
        : points.filter((point) => point.observedAt >= windowStart),
    [points, windowStart]
  )

  const characters = useMemo(
    () => [
      ...new Set(
        windowPoints
          .map((point) => point.character)
          .filter((value): value is string => Boolean(value))
      )
    ],
    [windowPoints]
  )

  const recentCharacter = recentMatches[0]?.myChar ?? windowPoints[windowPoints.length - 1]?.character ?? null
  const selectedCharacter = character ?? recentCharacter ?? 'all'
  const effectiveCharacter =
    selectedCharacter === 'all' || characters.includes(selectedCharacter)
      ? selectedCharacter
      : 'all'

  const filtered = useMemo(
    () =>
      effectiveCharacter === 'all'
        ? windowPoints
        : windowPoints.filter((point) => point.character === effectiveCharacter),
    [windowPoints, effectiveCharacter]
  )

  const stats = useMemo(() => {
    const values = filtered.map((point) => point.value)
    return {
      current: values.length ? values[values.length - 1] : null,
      high: values.length ? Math.max(...values) : null,
      low: values.length ? Math.min(...values) : null,
      count: filtered.length
    }
  }, [filtered])

  const ratingDeltas = useMemo(() => buildRatingDeltas(points), [points])

  const session = dashboard?.session ?? null
  const sessionDelta = session ? (kind === 'LP' ? session.lpDelta : session.ratingDelta) : null
  const sessionDeltaClass =
    sessionDelta === null ? '' : sessionDelta > 0 ? 'up' : sessionDelta < 0 ? 'down' : ''
  const sessionDeltaText =
    sessionDelta === null
      ? '—'
      : `${sessionDelta > 0 ? '+' : ''}${sessionDelta.toLocaleString()}`

  const refresh = (): void => {
    if (!shortId) return
    setBusy(true)
    void refreshSession(shortId).finally(() => setBusy(false))
  }

  return (
    <div className="pro pro-chart">
      <main className="main-panel chart-layout">
        <aside className="session-hero chart-sidebar">
          <div className="session-summary">
            <div className="session-line">
              <div className={`session-gain ${sessionDeltaClass}`}>{sessionDeltaText}</div>
              <span className="session-kind">{kind}</span>
              <span className="session-label">本次会话净上分</span>
            </div>
            <div className="session-meta">
              {session ? `${session.matches} 场 · ${session.wins}W ${session.losses}L` : '0 场 · 0W 0L'}
            </div>
          </div>

          <div className="toolbar chart-controls">
            <div className="pills">
              {(['MR', 'LP'] as const).map((value) => (
                <button
                  key={value}
                  className={kind === value ? 'pill active' : 'pill'}
                  onClick={() => setKind(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <select
              className="select chart-character-select"
              value={effectiveCharacter}
              onChange={(event) => setCharacter(event.target.value)}
            >
              <option value="all">全部角色</option>
              {characters.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="stats-inline chart-stats">
            <div className="chart-stat">
              <span>最近场次</span>
              <strong>{Math.min(RECENT_MATCH_LIMIT, matches.length)} 场</strong>
            </div>
            <div className="chart-stat">
              <span>当前</span>
              <strong>{stats.current?.toLocaleString() ?? '—'}</strong>
            </div>
            <div className="chart-stat">
              <span>最高</span>
              <strong>{stats.high?.toLocaleString() ?? '—'}</strong>
            </div>
            <div className="chart-stat">
              <span>最低</span>
              <strong>{stats.low?.toLocaleString() ?? '—'}</strong>
            </div>
          </div>

          <div className="chart-status">
            <span className="status">
              {sync.state}
              {sync.message ? ` · ${sync.message}` : ''}
            </span>
            <span className="muted">{shortId ?? '未选择账号'}</span>
          </div>

          <button className="chip session-refresh" disabled={!shortId || busy} onClick={refresh}>
            刷新
          </button>
        </aside>

        <section className="chart-column">
          <TrendChart
            points={filtered}
            kind={kind}
            matches={matches}
            deltas={ratingDeltas}
          />
        </section>
      </main>
    </div>
  )
}
