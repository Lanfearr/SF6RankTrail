import { useEffect, useMemo, useState } from 'react'
import type { MatchupStat, RivalStat } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'

interface Props {
  shortId: string | null
  lastEvent: string
}

const percent = (value: number): string => `${Math.round(value * 100)}%`

const resultText = (result: RivalStat['lastResult']): string =>
  result === 'win' ? '胜' : result === 'loss' ? '负' : '平'

export function OpponentsPage({ shortId, lastEvent }: Props) {
  const [matchups, setMatchups] = useState<MatchupStat[]>([])
  const [rivals, setRivals] = useState<RivalStat[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!shortId) {
      setMatchups([])
      setRivals([])
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([window.api.matchupStats(shortId), window.api.rivalStats(shortId, 40)])
      .then(([matchupRows, rivalRows]) => {
        if (cancelled) return
        setMatchups(matchupRows)
        setRivals(rivalRows)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, lastEvent])

  const summary = useMemo(() => {
    const most = matchups[0] ?? null
    const sample = matchups.filter((row) => row.matches >= 3)
    const pool = sample.length > 0 ? sample : matchups
    const toughest =
      [...pool].sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0] ?? null
    return { most, toughest }
  }, [matchups])

  const empty = matchups.length === 0 && rivals.length === 0

  return (
    <div className="page">
      <PageHeader title="对手分析" subtitle="按对手角色与玩家 ID 统计 matchup 和宿敌" />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : empty ? (
        <EmptyState title="暂无对手数据" detail="同步对局后会在这里汇总对手角色和宿敌。" />
      ) : (
        <>
          <div className="stat-grid three">
            <StatCard label="对手角色" value={matchups.length} detail={`${rivals.length} 名已知对手`} />
            <StatCard
              label="最常遇到"
              value={summary.most?.character ?? '—'}
              detail={summary.most ? `${summary.most.matches} 场 · 胜率 ${percent(summary.most.winRate)}` : '—'}
            />
            <StatCard
              label="最苦手"
              value={summary.toughest?.character ?? '—'}
              detail={
                summary.toughest
                  ? `${summary.toughest.matches} 场 · 胜率 ${percent(summary.toughest.winRate)}`
                  : '—'
              }
              tone="down"
            />
          </div>

          <div className="two-column">
            <section className="card">
              <div className="card-header">
                <h2>按对手角色</h2>
                <span className="badge">{matchups.length}</span>
              </div>
              <div className="stats-table compact-table matchup-table">
                <div className="stats-table-head">
                  <span>角色</span>
                  <span>对局</span>
                  <span>胜负</span>
                  <span>胜率</span>
                  <span>最近</span>
                </div>
                {matchups.map((row) => (
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
                      {percent(row.winRate)}
                    </span>
                    <span className="muted">{new Date(row.lastPlayedAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2>宿敌追踪</h2>
                <span className="badge">{rivals.length}</span>
              </div>
              {rivals.length === 0 ? (
                <EmptyState title="暂无可识别的对手 ID" detail="对局数据中缺少 opponent_id。" />
              ) : (
                <div className="stats-table compact-table rival-table">
                  <div className="stats-table-head">
                    <span>玩家 ID</span>
                    <span>对局</span>
                    <span>胜负</span>
                    <span>胜率</span>
                    <span>最近结果</span>
                    <span>最近对局</span>
                  </div>
                  {rivals.map((row) => (
                    <div className="stats-table-row" key={row.opponentId}>
                      <strong className="truncate" title={row.opponentId}>
                        {row.opponentId}
                      </strong>
                      <span>{row.matches}</span>
                      <span>
                        {row.wins}W {row.losses}L
                      </span>
                      <span className="rate-cell">
                        <span className="rate-bar">
                          <span style={{ width: `${Math.round(row.winRate * 100)}%` }} />
                        </span>
                        {percent(row.winRate)}
                      </span>
                      <span className={`result ${row.lastResult}`}>{resultText(row.lastResult)}</span>
                      <span className="muted">{new Date(row.lastPlayedAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
