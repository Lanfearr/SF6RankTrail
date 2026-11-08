import type {
  Match,
  MatchQuery,
  Player,
  PlayerDashboard,
  RatingPoint,
  RatingQuery,
  RatingSnapshot,
  SessionSummary
} from '../../shared/types'
import type { Db } from './migrate'

interface PlayerRow {
  short_id: string
  cfn: string | null
  display_name: string | null
  is_self: number
  last_synced: number | null
  created_at: number
}

interface MatchRow {
  replay_id: string
  short_id: string
  opponent_id: string | null
  my_char: string | null
  opp_char: string | null
  result: Match['result']
  my_mr: number | null
  opp_mr: number | null
  my_lp: number | null
  played_at: number
  season: string | null
  created_at: number
}

interface RatingRow {
  id: number
  short_id: string
  character: string | null
  kind: RatingPoint['kind']
  value: number
  source: RatingPoint['source']
  estimated: number
  observed_at: number
}

interface SessionRow {
  id: number
  short_id: string
  started_at: number
  ended_at: number | null
  start_rating: number | null
  end_rating: number | null
  start_lp: number | null
  end_lp: number | null
}

interface MatchTimeRow {
  played_at: number
  my_mr: number | null
  my_lp: number | null
}

interface SessionStatsRow {
  matches: number
  wins: number
  losses: number
}

interface RunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

const SESSION_GAP_MS = 3 * 60 * 60 * 1000

const toPlayer = (row: PlayerRow): Player => ({
  shortId: row.short_id,
  cfn: row.cfn,
  displayName: row.display_name,
  isSelf: row.is_self === 1,
  lastSynced: row.last_synced,
  createdAt: row.created_at
})

const toMatch = (row: MatchRow): Match => ({
  replayId: row.replay_id,
  shortId: row.short_id,
  opponentId: row.opponent_id,
  myChar: row.my_char,
  oppChar: row.opp_char,
  result: row.result,
  myMr: row.my_mr,
  oppMr: row.opp_mr,
  myLp: row.my_lp,
  playedAt: row.played_at,
  season: row.season,
  createdAt: row.created_at
})

const toRating = (row: RatingRow): RatingPoint => ({
  id: row.id,
  shortId: row.short_id,
  character: row.character,
  kind: row.kind,
  value: row.value,
  source: row.source,
  estimated: row.estimated === 1,
  observedAt: row.observed_at
})

export class Repository {
  constructor(private readonly db: Db) {}

  upsertPlayer(input: {
    shortId: string
    cfn?: string | null
    displayName?: string | null
    isSelf?: boolean
  }): Player {
    this.db
      .prepare(
        `INSERT INTO players (short_id, cfn, display_name, is_self, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(short_id) DO UPDATE SET
           cfn = COALESCE(excluded.cfn, players.cfn),
           display_name = COALESCE(excluded.display_name, players.display_name),
           is_self = MAX(players.is_self, excluded.is_self)`
      )
      .run(
        input.shortId,
        input.cfn ?? null,
        input.displayName ?? null,
        input.isSelf ? 1 : 0,
        Date.now()
      )

    const row = this.db.prepare('SELECT * FROM players WHERE short_id = ?').get(input.shortId) as
      PlayerRow | undefined
    if (!row) throw new Error(`player not found after upsert: ${input.shortId}`)
    return toPlayer(row)
  }

  listPlayers(): Player[] {
    const rows = this.db
      .prepare('SELECT * FROM players ORDER BY is_self DESC, created_at ASC')
      .all() as unknown as PlayerRow[]
    return rows.map(toPlayer)
  }

  markSynced(shortId: string, at = Date.now()): void {
    this.db.prepare('UPDATE players SET last_synced = ? WHERE short_id = ?').run(at, shortId)
  }

  insertMatch(match: Match): boolean {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO matches
          (replay_id, short_id, opponent_id, my_char, opp_char, result,
           my_mr, opp_mr, my_lp, played_at, season, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        match.replayId,
        match.shortId,
        match.opponentId,
        match.myChar,
        match.oppChar,
        match.result,
        match.myMr,
        match.oppMr,
        match.myLp,
        match.playedAt,
        match.season,
        match.createdAt
      ) as unknown as RunResult
    return Number(info.changes) > 0
  }

  hasMatch(replayId: string): boolean {
    const row = this.db.prepare('SELECT 1 AS ok FROM matches WHERE replay_id = ?').get(replayId)
    return Boolean(row)
  }

  listMatches(query: MatchQuery): Match[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM matches
         WHERE short_id = ?
         ORDER BY played_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(query.shortId, query.limit ?? 50, query.offset ?? 0) as unknown as MatchRow[]
    return rows.map(toMatch)
  }

  insertRating(point: Omit<RatingPoint, 'id'>): RatingPoint {
    const info = this.db
      .prepare(
        `INSERT INTO rating_points
          (short_id, character, kind, value, source, estimated, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        point.shortId,
        point.character,
        point.kind,
        point.value,
        point.source,
        point.estimated ? 1 : 0,
        point.observedAt
      ) as unknown as RunResult

    const row = this.db
      .prepare('SELECT * FROM rating_points WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as RatingRow | undefined
    if (!row) throw new Error('rating not found after insert')
    return toRating(row)
  }

  listRatings(query: RatingQuery): RatingPoint[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM rating_points
         WHERE short_id = ? AND kind = ?
           AND observed_at >= ? AND observed_at <= ?
         ORDER BY observed_at ASC`
      )
      .all(
        query.shortId,
        query.kind,
        query.from ?? 0,
        query.to ?? Number.MAX_SAFE_INTEGER
      ) as unknown as RatingRow[]
    return rows.map(toRating)
  }

  rebuildSessions(shortId: string): void {
    const rows = this.db
      .prepare(
        'SELECT played_at, my_mr, my_lp FROM matches WHERE short_id = ? ORDER BY played_at ASC'
      )
      .all(shortId) as unknown as MatchTimeRow[]

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM sessions WHERE short_id = ?').run(shortId)
      const insert = this.db.prepare(
        `INSERT INTO sessions
          (short_id, started_at, ended_at, start_rating, end_rating, start_lp, end_lp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )

      let current: {
        start: number
        end: number
        startRating: number | null
        endRating: number | null
        startLp: number | null
        endLp: number | null
      } | null = null

      const flush = (): void => {
        if (!current) return
        insert.run(
          shortId,
          current.start,
          current.end,
          current.startRating,
          current.endRating,
          current.startLp,
          current.endLp
        )
        current = null
      }

      for (const row of rows) {
        if (!current || row.played_at - current.end > SESSION_GAP_MS) {
          flush()
          current = {
            start: row.played_at,
            end: row.played_at,
            startRating: row.my_mr,
            endRating: row.my_mr,
            startLp: row.my_lp,
            endLp: row.my_lp
          }
        } else {
          current.end = row.played_at
          if (row.my_mr !== null) current.endRating = row.my_mr
          if (row.my_lp !== null) current.endLp = row.my_lp
        }
      }

      flush()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  listSessions(shortId: string): SessionSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE short_id = ? ORDER BY started_at ASC')
      .all(shortId) as unknown as SessionRow[]
    return rows.map((row) => this.toSessionSummary(row))
  }

  getLatestSession(shortId: string): SessionSummary | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE short_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(shortId) as SessionRow | undefined
    return row ? this.toSessionSummary(row) : null
  }

  private toSessionSummary(row: SessionRow): SessionSummary {
    const stats = this.db
      .prepare(
        `SELECT
           COUNT(*) AS matches,
           COALESCE(SUM(result = 'win'), 0) AS wins,
           COALESCE(SUM(result = 'loss'), 0) AS losses
         FROM matches
         WHERE short_id = ? AND played_at >= ? AND played_at <= ?`
      )
      .get(row.short_id, row.started_at, row.ended_at ?? row.started_at) as
      SessionStatsRow | undefined

    const ratingDelta =
      row.start_rating !== null && row.end_rating !== null
        ? row.end_rating - row.start_rating
        : null
    const lpDelta = row.start_lp !== null && row.end_lp !== null ? row.end_lp - row.start_lp : null

    return {
      shortId: row.short_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      matches: Number(stats?.matches ?? 0),
      wins: Number(stats?.wins ?? 0),
      losses: Number(stats?.losses ?? 0),
      ratingDelta,
      lpDelta
    }
  }

  getLatestRating(shortId: string, kind: RatingPoint['kind']): RatingPoint | null {
    const row = this.db
      .prepare(
        `SELECT * FROM rating_points
         WHERE short_id = ? AND kind = ?
         ORDER BY observed_at DESC, id DESC
         LIMIT 1`
      )
      .get(shortId, kind) as RatingRow | undefined
    return row ? toRating(row) : null
  }

  getDashboard(shortId: string): PlayerDashboard | null {
    const player = this.db.prepare('SELECT * FROM players WHERE short_id = ?').get(shortId) as
      PlayerRow | undefined
    if (!player) return null

    const toSnapshot = (point: RatingPoint | null): RatingSnapshot | null =>
      point
        ? {
            kind: point.kind,
            value: point.value,
            character: point.character,
            observedAt: point.observedAt
          }
        : null

    return {
      player: toPlayer(player),
      latestMr: toSnapshot(this.getLatestRating(shortId, 'MR')),
      latestLp: toSnapshot(this.getLatestRating(shortId, 'LP')),
      session: this.getLatestSession(shortId)
    }
  }

  listDashboards(): PlayerDashboard[] {
    return this.listPlayers()
      .map((player) => this.getDashboard(player.shortId))
      .filter((dashboard): dashboard is PlayerDashboard => dashboard !== null)
  }

  countMatches(shortId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM matches WHERE short_id = ?')
      .get(shortId) as { total: number } | undefined
    return Number(row?.total ?? 0)
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row?.value ?? null
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(key, value)
  }
}
