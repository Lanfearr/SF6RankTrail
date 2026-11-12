import { useEffect, useMemo, useState } from 'react'
import type { CharacterStat, Match, MatchResult, RatingKind, RatingPoint } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader } from '../components/Page'
import { formatDelta } from '../lib/format'
import { buildRatingDeltas } from '../lib/ratings'
import { useAppStore } from '../store/useAppStore'

const PAGE_SIZE = 20

interface Props {
  shortId: string | null
  onSelectMatch: (match: Match) => void
}

export function MatchesPage({ shortId, onSelectMatch }: Props) {
  const lastEvent = useAppStore((state) => state.lastEvent)
  const [kind, setKind] = useState<RatingKind>('MR')
  const [result, setResult] = useState<MatchResult | 'all'>('all')
  const [character, setCharacter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Match[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [characters, setCharacters] = useState<CharacterStat[]>([])
  const [series, setSeries] = useState<RatingPoint[]>([])

  useEffect(() => {
    if (!shortId) {
      setCharacters([])
      return
    }
    void window.api.characterStats(shortId).then(setCharacters)
  }, [shortId, lastEvent])

  useEffect(() => {
    if (!shortId) {
      setSeries([])
      return
    }
    void window.api.ratingSeries({ shortId, kind }).then(setSeries)
  }, [shortId, kind, lastEvent])

  useEffect(() => {
    setPage(0)
  }, [shortId, kind, result, character, fromDate, toDate])

  useEffect(() => {
    if (!shortId) {
      setRows([])
      setTotal(0)
      return
    }
    let cancelled = false
    setLoading(true)
    const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined
    const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined
    void window.api
      .listMatchPage({
        shortId,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        kind,
        result: result === 'all' ? null : result,
        character: character === 'all' ? null : character,
        from,
        to
      })
      .then((response) => {
        if (cancelled) return
        setRows(response.matches)
        setTotal(response.total)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId, kind, result, character, fromDate, toDate, page, lastEvent])

  const deltas = useMemo(() => buildRatingDeltas(series), [series])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="page">
      <PageHeader
        title="对战记录"
        subtitle={`${total} 场符合当前筛选 · 第 ${page + 1} / ${totalPages} 页`}
      />

      <div className="filter-bar">
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
          value={result}
          onChange={(event) => setResult(event.target.value as MatchResult | 'all')}
        >
          <option value="all">全部结果</option>
          <option value="win">胜利</option>
          <option value="loss">失败</option>
          <option value="draw">平局</option>
        </select>
        <select
          className="select"
          value={character}
          onChange={(event) => setCharacter(event.target.value)}
        >
          <option value="all">全部角色</option>
          {characters.map((entry) => (
            <option key={entry.character} value={entry.character}>
              {entry.character}
            </option>
          ))}
        </select>
        <label className="date-field">
          <span>从</span>
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label className="date-field">
          <span>到</span>
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <button
          className="btn"
          onClick={() => {
            setResult('all')
            setCharacter('all')
            setFromDate('')
            setToDate('')
          }}
        >
          清除筛选
        </button>
      </div>

      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title="没有符合条件的对局" detail="调整筛选条件后再试。" />
      ) : (
        <>
          <div className="match-table">
            <div className="match-table-head">
              <span>时间</span>
              <span>结果</span>
              <span>对局</span>
              <span>赛前 {kind}</span>
              <span>变化</span>
              <span>对手 {kind}</span>
            </div>
            {rows.map((match) => {
              const rating = kind === 'MR' ? match.myMr : match.myLp
              const delta = deltas.get(match.playedAt) ?? null
              return (
                <button
                  type="button"
                  className="match-table-row"
                  key={match.replayId}
                  onClick={() => onSelectMatch(match)}
                >
                  <span className="muted">{new Date(match.playedAt).toLocaleString()}</span>
                  <span className={`result ${match.result}`}>
                    {match.result === 'win' ? '胜' : match.result === 'loss' ? '负' : '平'}
                  </span>
                  <span className="match-pair">
                    <CharacterIcon name={match.oppChar} result={match.result} />
                    <span>
                      {match.myChar ?? '?'} vs {match.oppChar ?? '?'}
                    </span>
                  </span>
                  <strong>{rating?.toLocaleString() ?? '—'}</strong>
                  <span className={delta === null ? 'muted' : delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'}>
                    {delta === null ? '—' : formatDelta(delta)}
                  </span>
                  <span>{kind === 'MR' ? (match.oppMr?.toLocaleString() ?? '—') : '—'}</span>
                </button>
              )
            })}
          </div>

          <div className="pagination">
            <button className="btn" disabled={page <= 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
              上一页
            </button>
            <span className="muted">
              {page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} / {total}
            </span>
            <button
              className="btn"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  )
}
