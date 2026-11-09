import { useEffect, useMemo, useState } from 'react'
import type { Match, RatingKind, RatingPoint } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { EmptyState, LoadingBlock, PageHeader } from '../components/Page'
import { formatDelta } from '../lib/format'
import { buildRatingDeltas } from '../lib/ratings'

interface Props {
  shortId: string | null
  selectedMatch: Match | null
}

export function MatchDetailPage({ shortId, selectedMatch }: Props) {
  const [matches, setMatches] = useState<Match[]>([])
  const [series, setSeries] = useState<Record<RatingKind, RatingPoint[]>>({ MR: [], LP: [] })
  const [replayId, setReplayId] = useState(selectedMatch?.replayId ?? '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (selectedMatch) setReplayId(selectedMatch.replayId)
  }, [selectedMatch])

  useEffect(() => {
    if (!shortId) {
      setMatches([])
      setSeries({ MR: [], LP: [] })
      return
    }
    let cancelled = false
    setLoading(true)
    void Promise.all([
      window.api.listMatches({ shortId, limit: 200 }),
      window.api.ratingSeries({ shortId, kind: 'MR' }),
      window.api.ratingSeries({ shortId, kind: 'LP' })
    ])
      .then(([recent, mr, lp]) => {
        if (cancelled) return
        setMatches(recent)
        setSeries({ MR: mr, LP: lp })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [shortId])

  const options = useMemo(() => {
    if (!selectedMatch || matches.some((match) => match.replayId === selectedMatch.replayId)) {
      return matches
    }
    return [selectedMatch, ...matches]
  }, [matches, selectedMatch])

  const current =
    options.find((match) => match.replayId === replayId) ??
    selectedMatch ??
    options[0] ??
    null

  const kind: RatingKind = current?.myMr !== null ? 'MR' : 'LP'
  const deltas = useMemo(() => buildRatingDeltas(series[kind]), [series, kind])
  const delta = current ? (deltas.get(current.playedAt) ?? null) : null
  const rating = current ? (kind === 'MR' ? current.myMr : current.myLp) : null
  const opponentRating = current
    ? kind === 'MR'
      ? current.oppMr
      : current.oppLp
    : null

  return (
    <div className="page">
      <PageHeader
        title="对战详情"
        subtitle={current ? new Date(current.playedAt).toLocaleString() : '选择一场对局查看详情'}
        actions={
          <select
            className="select wide"
            value={current?.replayId ?? ''}
            onChange={(event) => setReplayId(event.target.value)}
            disabled={options.length === 0}
          >
            {options.length === 0 && <option value="">暂无对局</option>}
            {options.map((match) => (
              <option key={match.replayId} value={match.replayId}>
                {new Date(match.playedAt).toLocaleString()} · {match.myChar ?? '?'} vs {match.oppChar ?? '?'}
              </option>
            ))}
          </select>
        }
      />

      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : loading ? (
        <LoadingBlock />
      ) : !current ? (
        <EmptyState title="暂无对局" detail="同步数据后，这里会显示对局详情。" />
      ) : (
        <div className="detail-grid">
          <section className="card detail-hero">
            <div className="vs-block">
              <div className="fighter">
                <CharacterIcon name={current.myChar} result={current.result} />
                <span>{current.myChar ?? '未知角色'}</span>
                <small>我方</small>
              </div>
              <span className={`result-large ${current.result}`}>
                {current.result === 'win' ? '胜利' : current.result === 'loss' ? '失败' : '平局'}
              </span>
              <div className="fighter">
                <CharacterIcon name={current.oppChar} result={current.result} />
                <span>{current.oppChar ?? '未知角色'}</span>
                <small>对手</small>
              </div>
            </div>
            <div className="detail-kpis">
              <div>
                <span>赛前 {kind}</span>
                <strong>{rating?.toLocaleString() ?? '—'}</strong>
              </div>
              <div>
                <span>赛后变化</span>
                <strong className={delta === null ? '' : delta > 0 ? 'up' : delta < 0 ? 'down' : ''}>
                  {delta === null ? '—' : formatDelta(delta)}
                </strong>
              </div>
              <div>
                <span>对手 {kind}</span>
                <strong>{opponentRating?.toLocaleString() ?? '—'}</strong>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>基础信息</h2>
            </div>
            <div className="kv-list">
              <div>
                <span>对局时间</span>
                <strong>{new Date(current.playedAt).toLocaleString()}</strong>
              </div>
              <div>
                <span>赛季</span>
                <strong>{current.season ?? '—'}</strong>
              </div>
              <div>
                <span>Replay ID</span>
                <strong className="mono">{current.replayId}</strong>
              </div>
              <div>
                <span>账号</span>
                <strong>{current.shortId}</strong>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
