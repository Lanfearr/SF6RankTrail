import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { MatchupStat, RivalStat } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'

interface Props {
  shortId: string | null
  lastEvent: string
}

type MatchupSortKey = 'character' | 'matches' | 'record' | 'winRate' | 'lastPlayedAt'
type SortDirection = 'asc' | 'desc'

const percent = (value: number): string => `${Math.round(value * 100)}%`

const resultText = (result: RivalStat['lastResult']): string =>
  result === 'win' ? '胜' : result === 'loss' ? '负' : '平'

export function OpponentsPage({ shortId, lastEvent }: Props) {
  const [matchups, setMatchups] = useState<MatchupStat[]>([])
  const [rivals, setRivals] = useState<RivalStat[]>([])
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState<{ key: MatchupSortKey; direction: SortDirection }>({
    key: 'matches',
    direction: 'desc'
  })

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
    const most =
      [...matchups].sort((a, b) => b.matches - a.matches || b.lastPlayedAt - a.lastPlayedAt)[0] ??
      null
    const sample = matchups.filter((row) => row.matches >= 3)
    const pool = sample.length > 0 ? sample : matchups
    const toughest =
      [...pool].sort((a, b) => a.winRate - b.winRate || b.matches - a.matches)[0] ?? null
    return { most, toughest }
  }, [matchups])

  const sortedMatchups = useMemo(() => {
    const rows = [...matchups]
    rows.sort((a, b) => {
      let difference = 0
      if (sort.key === 'character') difference = a.character.localeCompare(b.character)
      else if (sort.key === 'matches') difference = a.matches - b.matches
      else if (sort.key === 'record') difference = a.wins - b.wins || a.losses - b.losses
      else if (sort.key === 'winRate') difference = a.winRate - b.winRate
      else difference = a.lastPlayedAt - b.lastPlayedAt

      if (difference === 0) difference = a.character.localeCompare(b.character)
      return sort.direction === 'asc' ? difference : -difference
    })
    return rows
  }, [matchups, sort])

  const toggleSort = (key: MatchupSortKey): void => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'character' ? 'asc' : 'desc' }
    )
  }

  const sortHeader = (key: MatchupSortKey, label: string): ReactNode => (
    <button
      type="button"
      className="sort-header"
      aria-label={`按${label}排序`}
      onClick={() => toggleSort(key)}
    >
      <span>{label}</span>
      <span className="sort-indicator" aria-hidden="true">
        {sort.key === key ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  )

  const ariaSort = (key: MatchupSortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'

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
            <StatCard
              label="对手角色"
              value={matchups.length}
              detail={`${rivals.length} 名已知对手`}
            />
            <StatCard
              label="最常遇到"
              value={summary.most?.character ?? '—'}
              detail={
                summary.most
                  ? `${summary.most.matches} 场 · 胜率 ${percent(summary.most.winRate)}`
                  : '—'
              }
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
                <div className="stats-table-head" role="row">
                  <span role="columnheader" aria-sort={ariaSort('character')}>
                    {sortHeader('character', '角色')}
                  </span>
                  <span role="columnheader" aria-sort={ariaSort('matches')}>
                    {sortHeader('matches', '对局')}
                  </span>
                  <span role="columnheader" aria-sort={ariaSort('record')}>
                    {sortHeader('record', '胜负')}
                  </span>
                  <span role="columnheader" aria-sort={ariaSort('winRate')}>
                    {sortHeader('winRate', '胜率')}
                  </span>
                  <span role="columnheader" aria-sort={ariaSort('lastPlayedAt')}>
                    {sortHeader('lastPlayedAt', '最近')}
                  </span>
                </div>
                {sortedMatchups.map((row) => (
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
                      <span className={`result ${row.lastResult}`}>
                        {resultText(row.lastResult)}
                      </span>
                      <span className="muted">
                        {new Date(row.lastPlayedAt).toLocaleDateString()}
                      </span>
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
