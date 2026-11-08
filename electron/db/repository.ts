import type {
  CurrentRating,
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

interface SessionMarkRow {
  short_id: string
  started_at: number
  start_mr: number | null
  start_lp: number | null
  updated_at: number
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

  setDisplayNameIfEmpty(shortId: string, displayName: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE players SET display_name = ?
         WHERE short_id = ? AND (display_name IS NULL OR display_name = '')`
      )
      .run(displayName, shortId) as unknown as RunResult
    return Number(info.changes) > 0
  }

  deletePlayer(shortId: string): boolean {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM rating_points WHERE short_id = ?').run(shortId)
      this.db.prepare('DELETE FROM sessions WHERE short_id = ?').run(shortId)
      this.db.prepare('DELETE FROM session_marks WHERE short_id = ?').run(shortId)
      this.db.prepare('DELETE FROM matches WHERE short_id = ?').run(shortId)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`backfill:${shortId}`)
      const info = this.db
        .prepare('DELETE FROM players WHERE short_id = ?')
        .run(shortId) as unknown as RunResult
      this.db.exec('COMMIT')
      return Number(info.changes) > 0
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
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

  recordCurrentRatings(
    shortId: string,
    ratings: CurrentRating[],
    at = Date.now()
  ): RatingPoint[] {
    const preferredCharacter = this.getLatestMatchCharacter(shortId)
    const entries: Array<{ character: string; kind: RatingPoint['kind']; value: number }> = []

    for (const rating of ratings) {
      const character = rating.character
      if (!character) continue
      if (rating.mr !== null && rating.mr > 0) {
        entries.push({ character, kind: 'MR', value: rating.mr })
      }
      if (rating.lp !== null && rating.lp > 0) {
        entries.push({ character, kind: 'LP', value: rating.lp })
      }
    }

    entries.sort(
      (a, b) =>
        Number(a.character === preferredCharacter) - Number(b.character === preferredCharacter)
    )

    const inserted: RatingPoint[] = []
    for (const entry of entries) {
      const latestMatchAt = this.getLatestMatchTime(shortId, entry.character)
      const last = this.getLatestRating(shortId, entry.kind, entry.character)
      const hasSnapshotAfterLatest =
        last !== null && latestMatchAt !== null && last.observedAt > latestMatchAt
      if (last?.value === entry.value && (latestMatchAt === null || hasSnapshotAfterLatest)) {
        continue
      }
      inserted.push(
        this.insertRating({
          shortId,
          character: entry.character,
          kind: entry.kind,
          value: entry.value,
          source: 'snapshot',
          estimated: false,
          observedAt: Math.max(at, (latestMatchAt ?? 0) + 1)
        })
      )
    }
    return inserted
  }

  getLatestMatchCharacter(shortId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT my_char FROM matches
         WHERE short_id = ? AND my_char IS NOT NULL
         ORDER BY played_at DESC
         LIMIT 1`
      )
      .get(shortId) as { my_char: string } | undefined
    return row?.my_char ?? null
  }

  private getLatestMatchTime(shortId: string, character: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MAX(played_at) AS played_at FROM matches
         WHERE short_id = ? AND my_char = ?`
      )
      .get(shortId, character) as { played_at: number | null } | undefined
    return row?.played_at ?? null
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
    if (!row) return null

    const session = this.toSessionSummary(row)
    const character = this.getLatestMatchCharacter(shortId)
    if (!character || row.ended_at === null) return session

    const latestMr = this.getLatestRating(shortId, 'MR', character)
    const latestLp = this.getLatestRating(shortId, 'LP', character)
    const currentMr = latestMr && latestMr.observedAt > row.ended_at ? latestMr : null
    const currentLp = latestLp && latestLp.observedAt > row.ended_at ? latestLp : null

    return {
      ...session,
      ratingDelta:
        row.start_rating !== null && currentMr !== null
          ? currentMr.value - row.start_rating
          : session.ratingDelta,
      lpDelta:
        row.start_lp !== null && currentLp !== null
          ? currentLp.value - row.start_lp
          : session.lpDelta
    }
  }

  startSession(shortId: string, at = Date.now()): SessionSummary {
    const character = this.getLatestMatchCharacter(shortId)
    const mr = this.getLatestRating(shortId, 'MR', character) ?? this.getLatestRating(shortId, 'MR')
    const lp = this.getLatestRating(shortId, 'LP', character) ?? this.getLatestRating(shortId, 'LP')
    this.db
      .prepare(
        `INSERT INTO session_marks (short_id, started_at, start_mr, start_lp, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(short_id) DO UPDATE SET
           started_at = excluded.started_at,
           start_mr = excluded.start_mr,
           start_lp = excluded.start_lp,
           updated_at = excluded.updated_at`
      )
      .run(shortId, at, mr?.value ?? null, lp?.value ?? null, Date.now())

    const session = this.getManualSession(shortId)
    if (!session) throw new Error(`session not found after start: ${shortId}`)
    return session
  }

  getActiveSession(shortId: string): SessionSummary | null {
    return this.getManualSession(shortId) ?? this.getLatestSession(shortId)
  }

  getManualSession(shortId: string): SessionSummary | null {
    const mark = this.db
      .prepare('SELECT * FROM session_marks WHERE short_id = ?')
      .get(shortId) as SessionMarkRow | undefined
    if (!mark) return null

    const stats = this.db
      .prepare(
        `SELECT
           COUNT(*) AS matches,
           COALESCE(SUM(result = 'win'), 0) AS wins,
           COALESCE(SUM(result = 'loss'), 0) AS losses
         FROM matches
         WHERE short_id = ? AND played_at >= ?`
      )
      .get(shortId, mark.started_at) as SessionStatsRow | undefined

    const character = this.getLatestMatchCharacter(shortId)
    const latestMr =
      this.getLatestRating(shortId, 'MR', character) ?? this.getLatestRating(shortId, 'MR')
    const latestLp =
      this.getLatestRating(shortId, 'LP', character) ?? this.getLatestRating(shortId, 'LP')

    return {
      shortId,
      startedAt: mark.started_at,
      endedAt: null,
      matches: Number(stats?.matches ?? 0),
      wins: Number(stats?.wins ?? 0),
      losses: Number(stats?.losses ?? 0),
      ratingDelta:
        mark.start_mr !== null && latestMr !== null ? latestMr.value - mark.start_mr : null,
      lpDelta: mark.start_lp !== null && latestLp !== null ? latestLp.value - mark.start_lp : null
    }
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

  getLatestRating(
    shortId: string,
    kind: RatingPoint['kind'],
    character?: string | null
  ): RatingPoint | null {
    const row = character
      ? (this.db
          .prepare(
            `SELECT * FROM rating_points
             WHERE short_id = ? AND kind = ? AND character = ?
             ORDER BY observed_at DESC, id DESC
             LIMIT 1`
          )
          .get(shortId, kind, character) as RatingRow | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM rating_points
             WHERE short_id = ? AND kind = ?
             ORDER BY observed_at DESC, id DESC
             LIMIT 1`
          )
          .get(shortId, kind) as RatingRow | undefined)
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

    const character = this.getLatestMatchCharacter(shortId)
    return {
      player: toPlayer(player),
      latestMr: toSnapshot(
        this.getLatestRating(shortId, 'MR', character) ?? this.getLatestRating(shortId, 'MR')
      ),
      latestLp: toSnapshot(
        this.getLatestRating(shortId, 'LP', character) ?? this.getLatestRating(shortId, 'LP')
      ),
      session: this.getActiveSession(shortId)
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
