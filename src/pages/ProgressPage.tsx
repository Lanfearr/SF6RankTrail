import { useEffect, useMemo, useState } from 'react'
import type { Match, RatingPoint } from '@shared/types'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'
import { buildRatingDeltas } from '../lib/ratings'
import { useAppStore } from '../store/useAppStore'

interface Props {
  shortId: string | null
  lastEvent: string
}

interface DayActivity {
  matches: number
  wins: number
  losses: number
  netMr: number
  netLp: number
}

const pad = (value: number): string => String(value).padStart(2, '0')

const dateKey = (value: number): string => {
  const date = new Date(value)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString()}`

const tone = (value: number | null): 'up' | 'down' | undefined =>
  value === null ? undefined : value > 0 ? 'up' : value < 0 ? 'down' : undefined

const parseTarget = (value: string): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const levelFor = (matches: number): number => {
  if (matches <= 0) return 0
  if (matches <= 2) return 1
  if (matches <= 5) return 2
  if (matches <= 9) return 3
  return 4
}

export function ProgressPage({ shortId, lastEvent }: Props) {
  const dashboards = useAppStore((state) => state.dashboards)
  const [matches, setMatches] = useState<Match[]>([])
  const [mrPoints, setMrPoints] = useState<RatingPoint[]>([])
  const [lpPoints, setLpPoints] = useState<RatingPoint[]>([])
  const [targetMr, setTargetMr] = useState('')
  const [targetLp, setTargetLp] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!shortId) {
      setMatches([])
      setMrPoints([])
      setLpPoints([])
      setTargetMr('')
      setTargetLp('')
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      window.api.listMatches({ shortId, limit: 1_000_000 }),
      window.api.ratingSeries({ shortId, kind: 'MR' }),
      window.api.ratingSeries({ shortId, kind: 'LP' }),
      window.api.getSetting(`goalMr:${shortId}`),
      window.api.getSetting(`goalLp:${shortId}`)
    ])
      .then(([matchRows, mrRows, lpRows, goalMr, goalLp]) => {
        if (cancelled) return
        setMatches(matchRows)
        setMrPoints(mrRows)
        setLpPoints(lpRows)
        setTargetMr(goalMr ?? '')
        setTargetLp(goalLp ?? '')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  const dashboard = useMemo(
    () => dashboards.find((entry) => entry.player.shortId === shortId) ?? null,
    [dashboards, shortId]
  )

  const mrDeltas = useMemo(() => buildRatingDeltas(mrPoints), [mrPoints])
  const lpDeltas = useMemo(() => buildRatingDeltas(lpPoints), [lpPoints])

  const currentMr = dashboard?.latestMr?.value ?? mrPoints[mrPoints.length - 1]?.value ?? null
  const currentLp = dashboard?.latestLp?.value ?? lpPoints[lpPoints.length - 1]?.value ?? null

  const daily = useMemo(() => {
    const map = new Map<string, DayActivity>()
    for (const match of matches) {
      const key = dateKey(match.playedAt)
      const row = map.get(key) ?? { matches: 0, wins: 0, losses: 0, netMr: 0, netLp: 0 }
      row.matches += 1
      if (match.result === 'win') row.wins += 1
      if (match.result === 'loss') row.losses += 1
      row.netMr += mrDeltas.get(match.playedAt) ?? 0
      row.netLp += lpDeltas.get(match.playedAt) ?? 0
      map.set(key, row)
    }
    return map
  }, [matches, mrDeltas, lpDeltas])

  const recent = useMemo(() => {
    const values = matches
      .slice(0, 20)
      .map((match) => mrDeltas.get(match.playedAt))
      .filter((value): value is number => value !== undefined)
    if (values.length === 0) return null
    const net = values.reduce((sum, value) => sum + value, 0)
    return { net, average: net / values.length, count: values.length }
  }, [matches, mrDeltas])

  const streak = useMemo(() => {
    const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt)
    let bestWin = 0
    let bestLoss = 0
    let runWin = 0
    let runLoss = 0
    for (const match of ordered) {
      if (match.result === 'win') {
        runWin += 1
        runLoss = 0
        bestWin = Math.max(bestWin, runWin)
      } else if (match.result === 'loss') {
        runLoss += 1
        runWin = 0
        bestLoss = Math.max(bestLoss, runLoss)
      } else {
        runWin = 0
        runLoss = 0
      }
    }

    let current = 0
    let currentType: 'win' | 'loss' | null = null
    const latest = ordered[ordered.length - 1]
    if (latest && latest.result !== 'draw') {
      currentType = latest.result
      for (let index = ordered.length - 1; index >= 0; index -= 1) {
        if (ordered[index]?.result !== currentType) break
        current += 1
      }
    }
    return { bestWin, bestLoss, current, currentType }
  }, [matches])

  const targetMrValue = parseTarget(targetMr)
  const targetLpValue = parseTarget(targetLp)
  const remaining = targetMrValue !== null && currentMr !== null ? targetMrValue - currentMr : null
  const progress =
    targetMrValue !== null && currentMr !== null
      ? Math.min(100, Math.max(0, (currentMr / targetMrValue) * 100))
      : 0
  const estimate =
    remaining !== null && remaining > 0 && recent !== null && recent.average > 0
      ? Math.ceil(remaining / recent.average)
      : null

  const calendar = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const mondayOffset = (today.getDay() + 6) % 7
    const start = new Date(today)
    start.setDate(today.getDate() - mondayOffset - 11 * 7)

    return Array.from({ length: 12 }, (_, week) =>
      Array.from({ length: 7 }, (_, day) => {
        const date = new Date(start)
        date.setDate(start.getDate() + week * 7 + day)
        const key = dateKey(date.getTime())
        const stat = daily.get(key)
        return {
          key,
          date,
          stat,
          level: levelFor(stat?.matches ?? 0),
          future: date.getTime() > today.getTime()
        }
      })
    )
  }, [daily])

  const saveGoal = async (): Promise<void> => {
    if (!shortId) return
    setSaving(true)
    try {
      await Promise.all([
        window.api.setSetting(`goalMr:${shortId}`, targetMr.trim()),
        window.api.setSetting(`goalLp:${shortId}`, targetLp.trim())
      ])
      setMessage('目标已保存')
    } finally {
      setSaving(false)
    }
  }

  const streakLabel =
    streak.currentType === 'win'
      ? `连胜 ${streak.current}`
      : streak.currentType === 'loss'
        ? `连败 ${streak.current}`
        : '—'

  return (
    <div className="page">
      <PageHeader title="目标与趋势" subtitle="追踪 MR 目标、连续上分与近 12 周活跃度" />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="当前 MR"
              value={currentMr?.toLocaleString() ?? '—'}
              detail={dashboard?.latestMr?.character ?? '暂无 MR 数据'}
            />
            <StatCard
              label="目标 MR"
              value={targetMrValue?.toLocaleString() ?? '未设置'}
              detail={remaining === null ? '设置目标后会显示差距' : remaining > 0 ? `还差 ${remaining} MR` : `已达成 +${Math.abs(remaining)}`}
              tone={remaining !== null && remaining <= 0 ? 'up' : undefined}
            />
            <StatCard
              label="当前连续"
              value={streakLabel}
              detail={`最佳 ${streak.bestWin} 连胜 · 最长 ${streak.bestLoss} 连败`}
              tone={streak.currentType === 'win' ? 'up' : streak.currentType === 'loss' ? 'down' : undefined}
            />
            <StatCard
              label="近 20 场场均"
              value={signed(recent === null ? null : Math.round(recent.average))}
              tone={tone(recent === null ? null : Math.round(recent.average))}
              detail={estimate === null ? '按 MR 变化估算' : `约 ${estimate} 场达到目标`}
            />
          </div>

          <div className="two-column">
            <section className="card goal-card">
              <div className="card-header">
                <h2>MR / LP 目标</h2>
                <span className="badge">按账号保存</span>
              </div>
              <div className="goal-inputs">
                <label>
                  <span>目标 MR</span>
                  <input
                    className="input compact"
                    inputMode="numeric"
                    placeholder={currentMr ? String(currentMr + 100) : '2000'}
                    value={targetMr}
                    onChange={(event) => setTargetMr(event.target.value)}
                  />
                </label>
                <label>
                  <span>目标 LP</span>
                  <input
                    className="input compact"
                    inputMode="numeric"
                    placeholder={currentLp ? String(currentLp + 1000) : '25000'}
                    value={targetLp}
                    onChange={(event) => setTargetLp(event.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={saving} onClick={() => void saveGoal()}>
                  {saving ? '保存中…' : '保存目标'}
                </button>
              </div>
              <div className="goal-progress">
                <div className="goal-line">
                  <span>MR 进度</span>
                  <strong>
                    {currentMr?.toLocaleString() ?? '—'} / {targetMrValue?.toLocaleString() ?? '—'}
                  </strong>
                </div>
                <div className="rate-bar large">
                  <span style={{ width: `${Math.round(progress)}%` }} />
                </div>
                <p className="muted small">
                  {targetMrValue === null
                    ? '输入目标 MR 后会计算进度与预计场次。'
                    : remaining !== null && remaining > 0
                      ? `距离目标还差 ${remaining.toLocaleString()} MR${estimate !== null ? `，按近期场均约 ${estimate} 场` : ''}。`
                      : '目标已达成，继续保持。'}
                </p>
              </div>
              {targetLpValue !== null && (
                <div className="goal-line">
                  <span>LP 目标</span>
                  <strong>
                    {currentLp?.toLocaleString() ?? '—'} / {targetLpValue.toLocaleString()}
                  </strong>
                </div>
              )}
            </section>

            <section className="card streak-card">
              <div className="card-header">
                <h2>连续上分</h2>
                <span className="badge">{matches.length} 场样本</span>
              </div>
              <div className="streak-hero">
                <span className={streak.currentType ? `result ${streak.currentType}` : 'result draw'}>
                  {streak.currentType === 'win' ? '胜' : streak.currentType === 'loss' ? '负' : '—'}
                </span>
                <div>
                  <strong>{streakLabel}</strong>
                  <span className="muted">
                    最近一场 {matches[0] ? new Date(matches[0].playedAt).toLocaleString() : '—'}
                  </span>
                </div>
              </div>
              <div className="kv-list compact">
                <div>
                  <span>最佳连胜</span>
                  <strong>{streak.bestWin} 场</strong>
                </div>
                <div>
                  <span>最长连败</span>
                  <strong>{streak.bestLoss} 场</strong>
                </div>
                <div>
                  <span>近 20 场净 MR</span>
                  <strong className={tone(recent === null ? null : Math.round(recent.net)) ?? ''}>
                    {signed(recent === null ? null : Math.round(recent.net))}
                  </strong>
                </div>
              </div>
            </section>
          </div>

          <section className="card calendar-card">
            <div className="card-header">
              <h2>近 12 周活跃度</h2>
              <span className="muted">颜色越亮，对局越多</span>
            </div>
            <div className="heatmap-scroll">
              <div className="heatmap">
                {calendar.map((week, weekIndex) => (
                  <div className="heatmap-week" key={weekIndex}>
                    {week.map((day) => {
                      const label = day.stat
                        ? `${day.date.toLocaleDateString()} · ${day.stat.matches} 场 · ${day.stat.wins}W ${day.stat.losses}L · ${signed(Math.round(day.stat.netMr))} MR`
                        : `${day.date.toLocaleDateString()} · 无对局`
                      return (
                        <span
                          key={day.key}
                          className={`heatmap-cell level-${day.level}${day.future ? ' future' : ''}`}
                          title={label}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="heatmap-legend">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span className={`heatmap-cell level-${level}`} key={level} />
              ))}
              <span>多</span>
            </div>
          </section>
        </>
      )}
      {message && <div className="toast">{message}</div>}
    </div>
  )
}
