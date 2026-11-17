import { useEffect, useMemo, useState } from 'react'
import type { Match, RatingKind, RatingPoint } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'
import { TrendChart } from '../components/TrendChart'
import { buildChartPoints, buildRatingDeltas } from '../lib/ratings'
import { useAppStore } from '../store/useAppStore'

const ALL_MATCHES_LIMIT = 1_000_000
const DAY_MS = 86_400_000

type TimeRange = 'all' | '1d' | '3d' | '7d' | '30d' | 'custom'

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString()}`

const tone = (value: number | null): 'up' | 'down' | undefined =>
  value === null ? undefined : value > 0 ? 'up' : value < 0 ? 'down' : undefined

interface Props {
  onSelectMatch?: (match: Match) => void
}

export function OverviewPage({ onSelectMatch }: Props) {
  const players = useAppStore((state) => state.players)
  const dashboards = useAppStore((state) => state.dashboards)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)
  const refreshSession = useAppStore((state) => state.refreshSession)

  const [matches, setMatches] = useState<Match[]>([])
  const [series, setSeries] = useState<Record<RatingKind, RatingPoint[]>>({ MR: [], LP: [] })
  const [loading, setLoading] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<RatingKind>('MR')
  const [character, setCharacter] = useState('all')
  const [range, setRange] = useState<TimeRange>('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const dashboard = useMemo(
    () => dashboards.find((entry) => entry.player.shortId === activeShortId) ?? null,
    [dashboards, activeShortId]
  )
  const shortId = dashboard?.player.shortId ?? null
  const session = dashboard?.session ?? null
  const running = sync.state === 'syncing'
  const winRate =
    session && session.matches > 0 ? Math.round((session.wins / session.matches) * 100) : null
  const recent = matches.slice(0, 6)

  useEffect(() => {
    if (!shortId) {
      setMatches([])
      setSeries({ MR: [], LP: [] })
      setChartError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setChartError(null)
    void Promise.all([
      window.api.listMatches({ shortId, limit: ALL_MATCHES_LIMIT }),
      window.api.ratingSeries({ shortId, kind: 'MR' }),
      window.api.ratingSeries({ shortId, kind: 'LP' })
    ])
      .then(([matchRows, mr, lp]) => {
        if (cancelled) return
        setMatches(matchRows)
        setSeries({ MR: mr, LP: lp })
      })
      .catch((error: unknown) => {
        if (!cancelled) setChartError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  useEffect(() => {
    setCharacter('all')
    setMatches([])
    setSeries({ MR: [], LP: [] })
  }, [shortId])

  const rangeBounds = useMemo<{ from: number | null; to: number | null }>(() => {
    if (range === 'custom') {
      const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null
      const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null
      return { from, to }
    }
    const days =
      range === '1d' ? 1 : range === '3d' ? 3 : range === '7d' ? 7 : range === '30d' ? 30 : null
    if (days === null) return { from: null, to: null }
    const now = Date.now()
    return { from: now - days * DAY_MS, to: now }
  }, [range, fromDate, toDate])

  const filteredMatches = useMemo(
    () =>
      matches.filter(
        (match) =>
          (rangeBounds.from === null || match.playedAt >= rangeBounds.from) &&
          (rangeBounds.to === null || match.playedAt <= rangeBounds.to)
      ),
    [matches, rangeBounds]
  )

  const filteredPoints = useMemo(
    () =>
      series[kind].filter(
        (point) =>
          (rangeBounds.from === null || point.observedAt >= rangeBounds.from) &&
          (rangeBounds.to === null || point.observedAt <= rangeBounds.to)
      ),
    [series, kind, rangeBounds]
  )

  const characters = useMemo(
    () => [
      ...new Set(
        filteredPoints
          .filter((point) => point.source === 'battlelog')
          .map((point) => point.character)
          .filter((value): value is string => Boolean(value))
      )
    ],
    [filteredPoints]
  )
  const effectiveCharacter =
    character === 'all' || characters.includes(character) ? character : 'all'

  const characterPoints = useMemo(
    () =>
      effectiveCharacter === 'all'
        ? filteredPoints
        : filteredPoints.filter((point) => point.character === effectiveCharacter),
    [filteredPoints, effectiveCharacter]
  )

  const chartPoints = useMemo(
    () => buildChartPoints(characterPoints, filteredMatches),
    [characterPoints, filteredMatches]
  )
  const ratingDeltas = useMemo(() => buildRatingDeltas(series[kind]), [series, kind])
  const invalidRange = range === 'custom' && Boolean(fromDate && toDate && fromDate > toDate)

  const changeRange = (value: TimeRange): void => {
    setRange(value)
    if (value !== 'custom') {
      setFromDate('')
      setToDate('')
    }
  }

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
        subtitle={
          dashboard
            ? `${dashboard.player.displayName ?? dashboard.player.cfn ?? dashboard.player.shortId} · ${dashboard.player.shortId}`
            : '尚未选择账号'
        }
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
              detail={
                dashboard.latestMr
                  ? new Date(dashboard.latestMr.observedAt).toLocaleString()
                  : '暂无数据'
              }
            />
            <StatCard
              label={`当前 LP${dashboard.latestLp?.character ? ` · ${dashboard.latestLp.character}` : ''}`}
              value={dashboard.latestLp?.value.toLocaleString() ?? '—'}
              detail={
                dashboard.latestLp
                  ? new Date(dashboard.latestLp.observedAt).toLocaleString()
                  : '暂无数据'
              }
            />
            <StatCard
              label="本会话 MR 净上分"
              value={signed(session?.ratingDelta ?? null)}
              tone={tone(session?.ratingDelta ?? null)}
              detail={
                session
                  ? `${session.matches} 场 · ${session.wins}W ${session.losses}L${winRate !== null ? ` · 胜率 ${winRate}%` : ''}`
                  : '尚未开始'
              }
            />
            <StatCard
              label="本会话 LP 净上分"
              value={signed(session?.lpDelta ?? null)}
              tone={tone(session?.lpDelta ?? null)}
              detail={
                session?.startedAt
                  ? `开始于 ${new Date(session.startedAt).toLocaleString()}`
                  : '尚未开始'
              }
            />
          </div>

          <section className="card overview-chart-card">
            <div className="card-header overview-chart-header">
              <div className="overview-chart-heading">
                <h2>分数变化</h2>
                <span className="muted">
                  {loading ? '加载中…' : `${chartPoints.length} 场 · 滚轮缩放查看`}
                </span>
              </div>
            </div>
            <div className="overview-chart-controls">
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
                className="select"
                aria-label="角色"
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
              <select
                className="select"
                aria-label="时间范围"
                value={range}
                onChange={(event) => changeRange(event.target.value as TimeRange)}
              >
                <option value="all">全部时间</option>
                <option value="1d">最近一天</option>
                <option value="3d">最近 3 天</option>
                <option value="7d">最近一周</option>
                <option value="30d">最近一月</option>
                <option value="custom">自定义日期</option>
              </select>
              <label className="date-field">
                <span>从</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => {
                    setFromDate(event.target.value)
                    setRange('custom')
                  }}
                />
              </label>
              <label className="date-field">
                <span>到</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => {
                    setToDate(event.target.value)
                    setRange('custom')
                  }}
                />
              </label>
            </div>
            {loading && chartPoints.length === 0 ? (
              <LoadingBlock />
            ) : chartError ? (
              <EmptyState title="图表加载失败" detail={chartError} />
            ) : invalidRange ? (
              <EmptyState title="日期范围无效" detail="开始日期不能晚于结束日期。" />
            ) : chartPoints.length === 0 ? (
              <EmptyState title="所选范围内暂无对局" detail="调整时间范围或选择其他角色后重试。" />
            ) : (
              <div className="overview-chart-panel">
                <TrendChart
                  points={chartPoints}
                  kind={kind}
                  matches={filteredMatches}
                  deltas={ratingDeltas}
                  xAxisMode="date"
                  showZoomSlider
                  onSelectMatch={onSelectMatch}
                />
              </div>
            )}
          </section>

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
                <button
                  className="btn primary"
                  disabled={busy || running}
                  onClick={() => void run(start)}
                >
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
                  <strong>
                    {dashboard.player.displayName ??
                      dashboard.player.cfn ??
                      dashboard.player.shortId}
                  </strong>
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
