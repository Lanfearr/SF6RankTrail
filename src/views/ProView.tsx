import { useEffect, useMemo, useState } from 'react'
import type { Match, RatingKind, RatingPoint } from '@shared/types'
import { CharacterIcon } from '../components/CharacterIcon'
import { TrendChart } from '../components/TrendChart'
import { useAppStore } from '../store/useAppStore'

export function ProView() {
  const dashboards = useAppStore((state) => state.dashboards)
  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const setActive = useAppStore((state) => state.setActive)
  const sync = useAppStore((state) => state.sync)
  const warning = useAppStore((state) => state.warning)
  const clearWarning = useAppStore((state) => state.clearWarning)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const refresh = useAppStore((state) => state.refresh)
  const addPlayer = useAppStore((state) => state.addPlayer)
  const removePlayer = useAppStore((state) => state.removePlayer)
  const refreshSession = useAppStore((state) => state.refreshSession)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)

  const [kind, setKind] = useState<RatingKind>('MR')
  const [character, setCharacter] = useState<string | null>(null)
  const [points, setPoints] = useState<RatingPoint[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [cfn, setCfn] = useState('')
  const [nickname, setNickname] = useState('')
  const [intervalMs, setIntervalMs] = useState('20000')
  const [opacity, setOpacity] = useState(1)
  const [busy, setBusy] = useState(false)

  const dashboard = useMemo(
    () =>
      dashboards.find((entry) => entry.player.shortId === activeShortId) ?? dashboards[0] ?? null,
    [dashboards, activeShortId]
  )
  const shortId = dashboard?.player.shortId ?? null
  const running = sync.state === 'syncing'

  useEffect(() => {
    if (!shortId) {
      setPoints([])
      setMatches([])
      return
    }

    let cancelled = false
    void (async () => {
      const [series, recent] = await Promise.all([
        window.api.ratingSeries({ shortId, kind }),
        window.api.listMatches({ shortId, limit: 100 })
      ])
      if (!cancelled) {
        setPoints(series)
        setMatches(recent)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [shortId, kind, lastEvent])

  useEffect(() => {
    void window.api.getSetting('syncIntervalMs').then((value) => {
      if (value) setIntervalMs(value)
    })
  }, [])

  useEffect(() => {
    setCharacter(null)
  }, [shortId])

  const characters = useMemo(
    () => [
      ...new Set(
        points.map((point) => point.character).filter((value): value is string => Boolean(value))
      )
    ],
    [points]
  )

  const recentCharacter =
    matches[0]?.myChar ?? points[points.length - 1]?.character ?? null
  const selectedCharacter = character ?? recentCharacter ?? 'all'
  const effectiveCharacter =
    selectedCharacter === 'all' || characters.includes(selectedCharacter)
      ? selectedCharacter
      : 'all'

  const filtered = useMemo(
    () =>
      effectiveCharacter === 'all'
        ? points
        : points.filter((point) => point.character === effectiveCharacter),
    [points, effectiveCharacter]
  )

  const stats = useMemo(() => {
    const values = filtered.map((point) => point.value)
    return {
      current: values.length ? values[values.length - 1] : null,
      high: values.length ? Math.max(...values) : null,
      low: values.length ? Math.min(...values) : null,
      count: filtered.length
    }
  }, [filtered])

  const ratingDeltas = useMemo(() => {
    const groups = new Map<string, RatingPoint[]>()
    for (const point of points) {
      const key = point.character ?? ''
      const group = groups.get(key)
      if (group) group.push(point)
      else groups.set(key, [point])
    }

    const deltas = new Map<number, number>()
    for (const group of groups.values()) {
      group.sort((a, b) => a.observedAt - b.observedAt || a.id - b.id)
      for (let index = 1; index < group.length; index += 1) {
        const previous = group[index - 1]
        const next = group[index]
        if (!previous || !next || next.observedAt <= previous.observedAt) continue
        deltas.set(previous.observedAt, next.value - previous.value)
      }
    }
    return deltas
  }, [points])

  const session = dashboard?.session ?? null
  const sessionDelta = session ? (kind === 'LP' ? session.lpDelta : session.ratingDelta) : null
  const sessionDeltaClass =
    sessionDelta === null ? '' : sessionDelta > 0 ? 'up' : sessionDelta < 0 ? 'down' : ''
  const sessionDeltaText =
    sessionDelta === null
      ? '—'
      : `${sessionDelta > 0 ? '+' : ''}${sessionDelta.toLocaleString()}`

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const applyInterval = async (): Promise<void> => {
    const value = Number(intervalMs)
    if (!Number.isFinite(value)) return
    await window.api.setSetting('syncIntervalMs', String(value))
    await refresh()
  }

  const applyOpacity = (value: number): void => {
    setOpacity(value)
    window.api.setOpacity(value)
  }

  const submitPlayer = async (): Promise<void> => {
    const value = cfn.trim()
    if (!value) return
    await addPlayer(value, nickname.trim() || undefined)
    setCfn('')
    setNickname('')
  }

  return (
    <div className="pro">
      {warning && (
        <div className="banner">
          <span>{warning}</span>
          <button className="chip" onClick={clearWarning}>
            忽略
          </button>
        </div>
      )}

      <aside className="sidebar">
        <div className="section-title">账号</div>
        <div className="player-tags">
          {players.length === 0 && <span className="muted">暂无账号</span>}
          {players.map((player) => {
            const accountName =
              player.displayName ??
              (player.cfn && player.cfn !== player.shortId ? player.cfn : null)
            const label = accountName ?? player.shortId
            return (
              <div
                key={player.shortId}
                className={
                  player.shortId === dashboard?.player.shortId ? 'player-tag active' : 'player-tag'
                }
                title={player.shortId}
                onClick={() => setActive(player.shortId)}
              >
                <button
                  type="button"
                  className="tag-remove"
                  title="删除账号"
                  aria-label={`删除 ${label}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation()
                    void run(() => removePlayer(player.shortId))
                  }}
                >
                  ×
                </button>
                <span className="tag-name">{label}</span>
                {accountName && <span className="tag-id">{player.shortId}</span>}
              </div>
            )
          })}
        </div>

        <div className="add-player">
          <input
            className="input"
            placeholder="CFN 或 short_id"
            value={cfn}
            onChange={(event) => setCfn(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitPlayer()
            }}
          />
          <div className="row">
            <input
              className="input"
              placeholder="昵称（可选）"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitPlayer()
              }}
            />
            <button className="chip" onClick={() => void submitPlayer()} disabled={busy}>
              添加
            </button>
          </div>
        </div>

        <div className="section-title">同步</div>
        <div className="actions">
          <button className="chip" disabled={busy} onClick={() => void run(login)}>
            登录
          </button>
          <button
            className="chip active"
            disabled={busy || running}
            onClick={() => void run(start)}
          >
            开始
          </button>
          <button className="chip" disabled={busy || !running} onClick={() => void run(stop)}>
            停止
          </button>
        </div>
        <div className="status-text">
          {sync.state}
          {sync.message ? ` · ${sync.message}` : ''}
        </div>

        <div className="section-title">设置</div>
        <div className="row">
          <label className="label">间隔 (ms)</label>
          <input
            className="input compact"
            value={intervalMs}
            onChange={(event) => setIntervalMs(event.target.value)}
          />
          <button className="chip" onClick={() => void applyInterval()}>
            应用
          </button>
        </div>
        <div className="row">
          <label className="label">不透明度</label>
          <input
            type="range"
            min={0.3}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(event) => applyOpacity(Number(event.target.value))}
          />
        </div>
      </aside>

      <main className="main-panel">
        <div className="session-hero">
          <div>
            <div className="session-label">本次会话净上分</div>
            <div className={`session-gain ${sessionDeltaClass}`}>
              {sessionDeltaText}
              <span className="session-kind">{kind}</span>
            </div>
            <div className="muted">
              {session ? `${session.matches} 场 · ${session.wins}W ${session.losses}L` : '尚未开始'}
            </div>
          </div>
          <button
            className="chip"
            disabled={!shortId || busy}
            onClick={() => shortId && void run(() => refreshSession(shortId))}
          >
            刷新
          </button>
        </div>

        <div className="toolbar">
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
            value={effectiveCharacter}
            onChange={(event) => setCharacter(event.target.value)}
          >
            <option value="all">全部角色</option>
            {characters.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <div className="stats-inline">
            当前 {stats.current?.toLocaleString() ?? '—'} · 最高{' '}
            {stats.high?.toLocaleString() ?? '—'} · 最低 {stats.low?.toLocaleString() ?? '—'} ·{' '}
            {stats.count} 场
          </div>
        </div>

        <TrendChart
          points={filtered}
          kind={kind}
          matches={matches}
          deltas={ratingDeltas}
        />

        <div className="match-list">
          <div className="section-title">最近对局</div>
          <ul>
            {matches.length === 0 && <li className="muted">暂无对局</li>}
            {matches.slice(0, 40).map((match) => (
              <li key={match.replayId}>
                <CharacterIcon
                  name={match.oppChar}
                  result={match.result}
                  delta={ratingDeltas.get(match.playedAt) ?? null}
                />
                <span className={`result ${match.result}`}>
                  {match.result === 'win' ? '胜' : match.result === 'loss' ? '负' : '平'}
                </span>
                <span>
                  {match.myChar ?? '?'} vs {match.oppChar ?? '?'}
                </span>
                <span className="muted">{new Date(match.playedAt).toLocaleString()}</span>
                <span>{match.myMr ?? match.myLp ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  )
}
