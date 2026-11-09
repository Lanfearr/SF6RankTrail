import { useEffect, useMemo, useState } from 'react'
import type { SessionHistoryEntry } from '@shared/types'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'

interface Props {
  shortId: string | null
  lastEvent: string
}

const signed = (value: number | null): string =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toLocaleString()}`

const tone = (value: number | null): 'up' | 'down' | undefined =>
  value === null ? undefined : value > 0 ? 'up' : value < 0 ? 'down' : undefined

const formatDuration = (row: SessionHistoryEntry): string => {
  if (row.endedAt === null) return '进行中'
  const minutes = Math.max(1, Math.round((row.endedAt - row.startedAt) / 60_000))
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}

export function SessionsPage({ shortId, lastEvent }: Props) {
  const [rows, setRows] = useState<SessionHistoryEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shortId) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api
      .sessionHistory(shortId, 120)
      .then((history) => {
        if (!cancelled) setRows(history)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  const summary = useMemo(() => {
    const matches = rows.reduce((sum, row) => sum + row.matches, 0)
    const best = rows.reduce<SessionHistoryEntry | null>((current, row) => {
      if (current === null) return row
      return (row.ratingDelta ?? -Infinity) > (current.ratingDelta ?? -Infinity) ? row : current
    }, null)
    return { matches, best }
  }, [rows])

  return (
    <div className="page">
      <PageHeader title="会话历史" subtitle="按 3 小时间隔自动切分，回顾每一次上分过程" />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="暂无会话历史" detail="同步对局后会在这里生成会话记录。" />
      ) : (
        <>
          <div className="stat-grid three">
            <StatCard label="会话数" value={rows.length} detail={`最近 ${rows.length} 次`} />
            <StatCard
              label="累计对局"
              value={summary.matches}
              detail={rows[0] ? `最近一次 ${new Date(rows[0].startedAt).toLocaleDateString()}` : '—'}
            />
            <StatCard
              label="最佳会话净上分"
              value={signed(summary.best?.ratingDelta ?? null)}
              tone={tone(summary.best?.ratingDelta ?? null)}
              detail={
                summary.best
                  ? `${summary.best.matches} 场 · ${new Date(summary.best.startedAt).toLocaleDateString()}`
                  : '—'
              }
            />
          </div>

          <div className="stats-table session-table">
            <div className="stats-table-head">
              <span>开始时间</span>
              <span>时长</span>
              <span>对局</span>
              <span>胜负</span>
              <span>MR 净分</span>
              <span>LP 净分</span>
              <span>MR 范围</span>
            </div>
            {rows.map((row) => (
              <div className="stats-table-row" key={`${row.startedAt}-${row.endedAt ?? 'open'}`}>
                <span className="muted">{new Date(row.startedAt).toLocaleString()}</span>
                <span>{formatDuration(row)}</span>
                <span>{row.matches}</span>
                <span>
                  {row.wins}W {row.losses}L
                </span>
                <span className={tone(row.ratingDelta) ?? 'muted'}>{signed(row.ratingDelta)}</span>
                <span className={tone(row.lpDelta) ?? 'muted'}>{signed(row.lpDelta)}</span>
                <span className="muted">
                  {row.startRating?.toLocaleString() ?? '—'} → {row.endRating?.toLocaleString() ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
