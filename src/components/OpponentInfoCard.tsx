import { useEffect, useMemo, useState } from 'react'
import type {
  OpponentFightAchievements,
  OpponentHistory,
  OpponentLeagueInfo,
  OpponentSeasonSummary
} from '@shared/types'
import { LoadingBlock } from './Page'

interface Props {
  shortId: string
  opponentId: string | null
  opponentName?: string | null
}

type TrendUnit = 'count' | 'percent' | 'second'

interface TrendItem {
  label: string
  value: number
  unit: TrendUnit
}

interface TrendGroup {
  title: string
  items: TrendItem[]
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const number = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString()

const decimal = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 })

const rate = (wins: number, matches: number): string =>
  matches > 0 ? `${Math.round((wins / matches) * 100)}%` : '—'

const date = (value: number): string => new Date(value).toLocaleDateString()

const trendValue = (item: TrendItem): string => {
  if (item.unit === 'percent') return `${decimal(Math.round(item.value * 10000) / 100)}%`
  if (item.unit === 'second') return `${decimal(item.value)} 秒`
  return `${decimal(item.value)} 次`
}

const buildTrendGroups = (trend: OpponentFightAchievements['trend']): TrendGroup[] => [
  {
    title: '斗气槽使用率',
    items: [
      { label: '斗气招架', value: trend.driveGaugeRate.driveParry, unit: 'percent' },
      { label: '斗气迸放', value: trend.driveGaugeRate.driveImpact, unit: 'percent' },
      { label: '斗气爆发技', value: trend.driveGaugeRate.driveArts, unit: 'percent' },
      { label: '招架斗气冲锋', value: trend.driveGaugeRate.driveRushFromParry, unit: 'percent' },
      { label: '取消斗气冲锋', value: trend.driveGaugeRate.driveRushFromCancel, unit: 'percent' },
      { label: '斗气反攻', value: trend.driveGaugeRate.driveReversal, unit: 'percent' },
      { label: '伤害', value: trend.driveGaugeRate.other, unit: 'percent' }
    ]
  },
  {
    title: '斗气反攻',
    items: [{ label: '使用次数', value: trend.driveReversalCount, unit: 'count' }]
  },
  {
    title: '斗气招架',
    items: [
      { label: '成功次数', value: trend.driveParry.success, unit: 'count' },
      { label: '摔投对手的斗气招架次数', value: trend.driveParry.throwOpponent, unit: 'count' },
      { label: '斗气招架被摔投次数', value: trend.driveParry.receivedThrow, unit: 'count' },
      { label: '完美招架次数', value: trend.driveParry.justParry, unit: 'count' }
    ]
  },
  {
    title: '斗气迸放（自行使用）',
    items: [
      { label: '成功次数', value: trend.driveImpact.success, unit: 'count' },
      { label: '确反康成功次数', value: trend.driveImpact.punishCounter, unit: 'count' },
      { label: '成功对上对手的斗气迸放次数', value: trend.driveImpact.clash, unit: 'count' }
    ]
  },
  {
    title: '斗气迸放（对手使用）',
    items: [
      { label: '承受次数', value: trend.driveImpact.received, unit: 'count' },
      { label: '受到确反康次数', value: trend.driveImpact.receivedPunishCounter, unit: 'count' },
      { label: '被对手的斗气迸放对上次数', value: trend.driveImpact.receivedClash, unit: 'count' }
    ]
  },
  {
    title: '超级必杀槽使用率',
    items: [
      { label: 'Lv1', value: trend.superArtsRate.lv1, unit: 'percent' },
      { label: 'Lv2', value: trend.superArtsRate.lv2, unit: 'percent' },
      { label: 'Lv3', value: trend.superArtsRate.lv3, unit: 'percent' },
      { label: '终极必杀技', value: trend.superArtsRate.ca, unit: 'percent' }
    ]
  },
  {
    title: '眩晕',
    items: [
      { label: '让对手眩晕次数', value: trend.stun.dealt, unit: 'count' },
      { label: '眩晕次数', value: trend.stun.received, unit: 'count' }
    ]
  },
  {
    title: '摔投',
    items: [
      { label: '成功次数', value: trend.throw.success, unit: 'count' },
      { label: '承受次数', value: trend.throw.received, unit: 'count' },
      { label: '拆投次数', value: trend.throw.tech, unit: 'count' }
    ]
  },
  {
    title: '版边',
    items: [
      { label: '将对手逼进版边的时间', value: trend.corner.opponentTime, unit: 'second' },
      { label: '被对手逼进版边的时间', value: trend.corner.selfTime, unit: 'second' }
    ]
  }
]

export function OpponentInfoCard({ shortId, opponentId, opponentName = null }: Props) {
  const [history, setHistory] = useState<OpponentHistory | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [seasons, setSeasons] = useState<OpponentSeasonSummary | null>(null)
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [league, setLeague] = useState<OpponentLeagueInfo | null>(null)
  const [achievements, setAchievements] = useState<OpponentFightAchievements | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)

  useEffect(() => {
    if (!shortId || !opponentId) {
      setHistory(null)
      setSeasons(null)
      setLeague(null)
      setAchievements(null)
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
    setAchievements(null)
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
      const summary = await window.api.opponentSeasons(opponentId)
      setSeasons(summary)
      setAchievements(summary.achievements)
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
        <div className="button-row">
          <button
            type="button"
            className="btn"
            disabled={!opponentId || !/^\d+$/.test(opponentId)}
            onClick={() => {
              if (opponentId) {
                void window.api
                  .openBucklerProfile(opponentId)
                  .catch((error) => setQueryError(message(error)))
              }
            }}
          >
            跳转 Buckler
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!opponentId || queryLoading}
            onClick={() => void queryBuckler()}
          >
            {queryLoading ? '查询中…' : seasons ? '刷新 Buckler' : '查询 Buckler'}
          </button>
        </div>
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

      {achievements && (
        <div className="opponent-section">
          <div className="opponent-section-title">
            <h3>格斗成就</h3>
            <span className="muted small">趋势为最近 100 场战斗的平均值</span>
          </div>
          <div className="opponent-achievement-grid">
            {buildTrendGroups(achievements.trend).map((group) => (
              <div className="opponent-achievement-group" key={group.title}>
                <h4>{group.title}</h4>
                <div className="kv-list compact">
                  {group.items.map((item) => (
                    <div key={item.label}>
                      <span>{item.label}</span>
                      <strong>{trendValue(item)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="opponent-achievement-grid">
            <div className="opponent-achievement-group">
              <h4>累计</h4>
              <div className="kv-list compact">
                <div>
                  <span>排位赛对战次数</span>
                  <strong>{number(achievements.totals.rankedMatches)} 次</strong>
                </div>
                <div>
                  <span>休闲赛对战次数</span>
                  <strong>{number(achievements.totals.casualMatches)} 次</strong>
                </div>
                <div>
                  <span>比赛间对战次数（1vs1）</span>
                  <strong>{number(achievements.totals.customRoomMatches)} 次</strong>
                </div>
                <div>
                  <span>格斗中心对战次数</span>
                  <strong>{number(achievements.totals.battleHubMatches)} 次</strong>
                </div>
                <div>
                  <span>累计格斗点</span>
                  <strong>{number(achievements.totals.totalFightPoints)} 点</strong>
                </div>
                <div>
                  <span>挑战完成次数</span>
                  <strong>{number(achievements.totals.challengeClearCount)} 次</strong>
                </div>
              </div>
            </div>
            <div className="opponent-achievement-group">
              <h4>V对手</h4>
              <div className="kv-list compact">
                <div>
                  <span>最高达到排位</span>
                  <strong>{achievements.rivalAi.highestRank ?? '—'}</strong>
                </div>
                <div>
                  <span>挑战完成数</span>
                  <strong>{number(achievements.rivalAi.challengeCount)} 次</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
