import { useEffect, useMemo, useState } from 'react'
import type { OpponentHistory, OpponentLeagueInfo, OpponentSeasonSummary } from '@shared/types'
import { LoadingBlock } from './Page'

interface Props {
  shortId: string
  opponentId: string | null
  opponentName?: string | null
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const number = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString()

const rate = (wins: number, matches: number): string =>
  matches > 0 ? `${Math.round((wins / matches) * 100)}%` : '—'

const date = (value: number): string => new Date(value).toLocaleDateString()

export function OpponentInfoCard({ shortId, opponentId, opponentName = null }: Props) {
  const [history, setHistory] = useState<OpponentHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<OpponentSeasonSummary | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [league, setLeague] = useState<OpponentLeagueInfo | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)

  useEffect(() => {
    if (!shortId || !opponentId) {
      setHistory(null)
      setSeasons(null)
      setLeague(null)
      setSelectedSeason(null)
      setHistoryError(null)
      setQueryError(null)
      return
    }

    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    setHistory(null)
    setSeasons(null)
    setLeague(null)
    setSelectedSeason(null)
    setQueryError(null)

    void window.api
      .opponentHistory(shortId, opponentId)
      .then((data) => {
        if (!cancelled) setHistory(data)
      })
      .catch((error: unknown) => {
        if (!cancelled) setHistoryError(message(error))
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [shortId, opponentId])

  const seasonOptions = useMemo(() => {
    if (!seasons) return []
    const ids = seasons.seasonIds.filter((id) => id !== seasons.currentSeasonId)
    ids.sort((a, b) => b - a)
    return seasons.currentSeasonId === null ? ids : [seasons.currentSeasonId, ...ids]
  }, [seasons])

  const queryLeague = async (seasonId: number, force: boolean): Promise<void> => {
    if (!opponentId) return
    setQueryLoading(true)
    setQueryError(null)
    try {
      const data = await window.api.opponentLeagueInfo(opponentId, seasonId, force)
      setLeague(data)
    } catch (error) {
      setQueryError(message(error))
    } finally {
      setQueryLoading(false)
    }
  }

  const queryBuckler = async (): Promise<void> => {
    if (!opponentId || queryLoading) return
    setQueryLoading(true)
    setQueryError(null)
    try {
      const summary = seasons ?? (await window.api.opponentSeasons(opponentId))
      if (!seasons) setSeasons(summary)
      const seasonId = summary.currentSeasonId ?? summary.seasonIds[0]
      if (seasonId === undefined) throw new Error('未获取到该对手的赛季信息')
      setSelectedSeason(seasonId)
      const data = await window.api.opponentLeagueInfo(opponentId, seasonId, true)
      setLeague(data)
    } catch (error) {
      setQueryError(message(error))
    } finally {
      setQueryLoading(false)
    }
  }

  const changeSeason = (value: string): void => {
    const seasonId = Number(value)
    setSelectedSeason(seasonId)
    void queryLeague(seasonId, false)
  }

  return (
    <section className="card opponent-card">
      <div className="card-header">
        <div>
          <h2>{opponentName ?? '对手信息'}</h2>
          <p className="muted small">
            {opponentId ? `对手 ID：${opponentId}` : '该场对战未记录对手 ID，无法查询 Buckler'}
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={!opponentId || queryLoading}
          onClick={() => void queryBuckler()}
        >
          {queryLoading ? '查询中…' : seasons ? '刷新 Buckler' : '查询 Buckler'}
        </button>
      </div>

      {historyLoading && <LoadingBlock label="加载交手记录…" />}
      {historyError && <p className="opponent-error">{historyError}</p>}

      {history && history.matches > 0 && (
        <div className="opponent-summary">
          <span>
            总计 <strong>{history.matches}</strong> 场
          </span>
          <span>
            胜 <strong>{history.wins}</strong> / 负 <strong>{history.losses}</strong>
          </span>
          <span>
            胜率 <strong>{rate(history.wins, history.matches)}</strong>
          </span>
          <span>最近交手 {date(history.lastPlayedAt)}</span>
        </div>
      )}

      <div className="opponent-section">
        <div className="opponent-section-title">
          <h3>本地交手记录</h3>
          <span className="muted small">MR / LP 为交手时对手值</span>
        </div>

        {history && history.seasons.length > 0 ? (
          history.seasons.map((season) => (
            <div className="opponent-season" key={season.key}>
              <div className="opponent-season-head">
                <strong>{season.label}</strong>
                <span className="muted small">
                  {season.matches} 场 · {season.wins} 胜 {season.losses} 负 · 最近{' '}
                  {date(season.lastPlayedAt)}
                </span>
              </div>
              <div className="stats-table opponent-table">
                <div className="stats-table-head">
                  <span>角色</span>
                  <span>场次</span>
                  <span>胜率</span>
                  <span>MR</span>
                  <span>LP</span>
                  <span>最近交手</span>
                </div>
                {season.characters.map((character) => (
                  <div
                    className="stats-table-row"
                    key={`${season.key}:${character.character}`}
                  >
                    <span>{character.character}</span>
                    <span>{character.matches}</span>
                    <span>{rate(character.wins, character.matches)}</span>
                    <span>{number(character.mr)}</span>
                    <span>{number(character.lp)}</span>
                    <span>{date(character.lastPlayedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        ) : (
          !historyLoading && <p className="muted">没有本地交手记录。</p>
        )}
      </div>

      {(seasons || league) && (
        <div className="opponent-section">
          <div className="opponent-section-title">
            <h3>Buckler 段位</h3>
            {league && (
              <span className="muted small">
                查询于 {new Date(league.fetchedAt).toLocaleString()}
                {league.cached ? ' · 缓存' : ''}
              </span>
            )}
          </div>
          <div className="button-row">
            <select
              className="select"
              value={selectedSeason ?? ''}
              disabled={queryLoading}
              onChange={(event) => changeSeason(event.target.value)}
            >
              {seasonOptions.map((seasonId) => (
                <option key={seasonId} value={seasonId}>
                  赛季 {seasonId}
                </option>
              ))}
              <option value={-1}>历史最高</option>
            </select>
            <button
              type="button"
              className="btn"
              disabled={selectedSeason === null || queryLoading}
              onClick={() => {
                if (selectedSeason !== null) void queryLeague(selectedSeason, true)
              }}
            >
              刷新
            </button>
          </div>

          {queryError && <p className="opponent-error">{queryError}</p>}
          {queryLoading && <LoadingBlock label="查询 Buckler 段位…" />}
          {!queryLoading && league && league.characters.length > 0 && (
            <div className="stats-table opponent-league-table">
              <div className="stats-table-head">
                <span>角色</span>
                <span>MR</span>
                <span>LP</span>
              </div>
              {league.characters.map((character) => (
                <div className="stats-table-row" key={character.character}>
                  <span>{character.character}</span>
                  <span>{number(character.mr)}</span>
                  <span>{number(character.lp)}</span>
                </div>
              ))}
            </div>
          )}
          {!queryLoading && league && league.characters.length === 0 && (
            <p className="muted">该赛季没有可用的段位数据。</p>
          )}
          {!queryLoading && !league && (
            <p className="muted">选择赛季后可查询该对手的公开段位数据。</p>
          )}
        </div>
      )}
    </section>
  )
}
