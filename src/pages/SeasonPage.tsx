import { useEffect, useMemo, useState } from 'react'
import type { SeasonStat } from '@shared/types'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'

interface Props {
  shortId: string | null
  lastEvent: string
}

export function SeasonPage({ shortId, lastEvent }: Props) {
  const [rows, setRows] = useState<SeasonStat[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shortId) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api
      .seasonReport(shortId)
      .then((report) => {
        if (!cancelled) setRows(report)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  const summary = useMemo(() => {
    const latest = rows[0] ?? null
    const totalMatches = rows.reduce((sum, row) => sum + row.matches, 0)
    return { latest, totalMatches }
  }, [rows])

  return (
    <div className="page">
      <PageHeader title="赛季报告" subtitle="按赛季或月份汇总对局表现" />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="暂无赛季数据" detail="同步对局后会在这里生成报告。" />
      ) : (
        <>
          <div className="stat-grid three">
            <StatCard
              label="当前周期"
              value={summary.latest?.label ?? '—'}
              detail={summary.latest ? `${summary.latest.matches} 场` : '—'}
            />
            <StatCard
              label="当前周期胜率"
              value={summary.latest ? `${Math.round(summary.latest.winRate * 100)}%` : '—'}
              detail={summary.latest ? `${summary.latest.wins}W ${summary.latest.losses}L` : '—'}
              tone={summary.latest ? (summary.latest.winRate >= 0.5 ? 'up' : 'down') : undefined}
            />
            <StatCard label="累计对局" value={summary.totalMatches} detail={`${rows.length} 个周期`} />
          </div>

          <div className="season-grid">
            {rows.map((row) => (
              <section className="card season-card" key={row.key}>
                <div className="card-header">
                  <h2>{row.label}</h2>
                  <span className="badge">{row.matches} 场</span>
                </div>
                <div className="season-winrate">
                  <strong>{Math.round(row.winRate * 100)}%</strong>
                  <span>
                    {row.wins}W {row.losses}L
                  </span>
                </div>
                <div className="rate-bar large">
                  <span style={{ width: `${Math.round(row.winRate * 100)}%` }} />
                </div>
                <div className="kv-list compact">
                  <div>
                    <span>时间范围</span>
                    <strong>
                      {new Date(row.firstPlayedAt).toLocaleDateString()} –{' '}
                      {new Date(row.lastPlayedAt).toLocaleDateString()}
                    </strong>
                  </div>
                  <div>
                    <span>MR 范围</span>
                    <strong>
                      {row.startMr?.toLocaleString() ?? '—'} → {row.endMr?.toLocaleString() ?? '—'}
                    </strong>
                  </div>
                  <div>
                    <span>LP 范围</span>
                    <strong>
                      {row.startLp?.toLocaleString() ?? '—'} → {row.endLp?.toLocaleString() ?? '—'}
                    </strong>
                  </div>
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
