import { useEffect, useMemo, useState } from 'react'
import type { CharacterStat } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'

interface Props {
  shortId: string | null
  lastEvent: string
}

export function CharactersPage({ shortId, lastEvent }: Props) {
  const [rows, setRows] = useState<CharacterStat[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shortId) {
      setRows([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.api
      .characterStats(shortId)
      .then((stats) => {
        if (!cancelled) setRows(stats)
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
    const wins = rows.reduce((sum, row) => sum + row.wins, 0)
    const best = [...rows].sort((a, b) => b.winRate - a.winRate)[0] ?? null
    return { matches, wins, best }
  }, [rows])

  return (
    <div className="page">
      <PageHeader title="角色统计" subtitle="按角色汇总胜率与当前分数" />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="暂无角色数据" detail="同步对局后会在这里汇总。" />
      ) : (
        <>
          <div className="stat-grid three">
            <StatCard label="使用角色" value={rows.length} detail="至少有一场对局" />
            <StatCard label="总对局" value={summary.matches} detail={`${summary.wins} 胜 · ${summary.matches - summary.wins} 负`} />
            <StatCard
              label="最高胜率"
              value={summary.best ? `${Math.round(summary.best.winRate * 100)}%` : '—'}
              detail={summary.best?.character ?? '—'}
              tone="up"
            />
          </div>

          <div className="stats-table">
            <div className="stats-table-head">
              <span>角色</span>
              <span>对局</span>
              <span>胜负</span>
              <span>胜率</span>
              <span>当前 MR</span>
              <span>当前 LP</span>
              <span>最后对局</span>
            </div>
            {rows.map((row) => (
              <div className="stats-table-row" key={row.character}>
                <span className="char-cell">
                  <CharacterIcon name={row.character} result="draw" />
                  <strong>{row.character}</strong>
                </span>
                <span>{row.matches}</span>
                <span>
                  {row.wins}W {row.losses}L
                </span>
                <span className="rate-cell">
                  <span className="rate-bar">
                    <span style={{ width: `${Math.round(row.winRate * 100)}%` }} />
                  </span>
                  {Math.round(row.winRate * 100)}%
                </span>
                <span>{row.currentMr?.toLocaleString() ?? '—'}</span>
                <span>{row.currentLp?.toLocaleString() ?? '—'}</span>
                <span className="muted">
                  {row.lastPlayedAt ? new Date(row.lastPlayedAt).toLocaleString() : '—'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
