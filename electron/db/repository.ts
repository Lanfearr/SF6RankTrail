import type {
  CharacterStat,
  CurrentRating,
  ImportSummary,
  Match,
  MatchQuery,
  MatchupStat,
  OpponentHistory,
  OpponentSeason,
  OpponentSeasonCharacter,
  Player,
  PlayerDashboard,
  RatingPoint,
  RatingQuery,
  RatingSnapshot,
  RivalStat,
  SeasonStat,
  SessionHistoryEntry,
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
  opp_lp: number | null
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
  character: string | null
  start_rating: number | null
  end_rating: number | null
  start_lp: number | null
  end_lp: number | null
}

interface MatchTimeRow {
  played_at: number
  my_char: string | null
  my_mr: number | null
  my_lp: number | null
}

interface SessionMarkRow {
  short_id: string
  started_at: number
  character: string | null
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

const DEFAULT_SESSION_IDLE_MS = 3 * 60 * 60 * 1000
const MIN_SESSION_IDLE_MS = 60_000
const MAX_SESSION_IDLE_MS = 24 * 60 * 60 * 1000
const SESSION_IDLE_SETTING_KEY = 'sessionIdleMs'

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
  oppLp: row.opp_lp,
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

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE;')
    try {
      const result = fn()
      this.db.exec('COMMIT;')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;')
      } catch {
        // preserve the original error
      }
      throw error
    }
  }

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
           my_mr, opp_mr, my_lp, opp_lp, played_at, season, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        match.oppLp,
        match.playedAt,
        match.season,
        match.createdAt
      ) as unknown as RunResult
    return Number(info.changes) > 0
  }

  importPlayerData(input: {
    player: Player
    matches: Match[]
    ratings: RatingPoint[]
  }): ImportSummary {
    const shortId = input.player.shortId
    let insertedMatches = 0
    let skippedMatches = 0
    let insertedRatings = 0
    let skippedRatings = 0

    this.upsertPlayer({
      shortId,
      cfn: input.player.cfn,
      displayName: input.player.displayName,
      isSelf: input.player.isSelf
    })

    this.db.exec('BEGIN')
    try {
      for (const match of input.matches) {
        if (
          !match ||
          typeof match.replayId !== 'string' ||
          !Number.isFinite(match.playedAt) ||
          !['win', 'loss', 'draw'].includes(match.result)
        ) {
          skippedMatches += 1
          continue
        }
        if (this.insertMatch({ ...match, shortId })) insertedMatches += 1
        else skippedMatches += 1
      }

      for (const point of input.ratings) {
        if (
          !point ||
          (point.kind !== 'MR' && point.kind !== 'LP') ||
          !Number.isFinite(point.value) ||
          !Number.isFinite(point.observedAt)
        ) {
          skippedRatings += 1
          continue
        }
        const exists = this.db
          .prepare(
            `SELECT 1 AS ok FROM rating_points
             WHERE short_id = ? AND kind = ? AND value = ? AND observed_at = ?
               AND COALESCE(character, '') = ? AND source = ?`
          )
          .get(
            shortId,
            point.kind,
            point.value,
            point.observedAt,
            point.character ?? '',
            point.source
          )
        if (exists) {
          skippedRatings += 1
          continue
        }
        this.insertRating({
          shortId,
          character: point.character,
          kind: point.kind,
          value: point.value,
          source: point.source,
          estimated: point.estimated === true,
          observedAt: point.observedAt
        })
        insertedRatings += 1
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }

    this.rebuildSessions(shortId)
    return {
      matches: insertedMatches,
      ratings: insertedRatings,
      skippedMatches,
      skippedRatings
    }
  }

  hasMatch(shortId: string, replayId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 AS ok FROM matches WHERE short_id = ? AND replay_id = ?')
      .get(shortId, replayId)
    return Boolean(row)
  }

  listMatches(query: MatchQuery): Match[] {
    const { where, params } = matchFilter(query)
    const rows = this.db
      .prepare(
        `SELECT * FROM matches
         WHERE ${where}
         ORDER BY played_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, query.limit ?? 50, query.offset ?? 0) as unknown as MatchRow[]
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

  private getSessionIdleMs(): number {
    const raw = this.getSetting(SESSION_IDLE_SETTING_KEY)
    if (raw === null || raw.trim() === '') return DEFAULT_SESSION_IDLE_MS
    const value = Number(raw)
    if (!Number.isFinite(value)) return DEFAULT_SESSION_IDLE_MS
    return Math.min(MAX_SESSION_IDLE_MS, Math.max(MIN_SESSION_IDLE_MS, Math.round(value)))
  }

  rebuildSessions(shortId: string): void {
    const rows = this.db
      .prepare(
        'SELECT played_at, my_char, my_mr, my_lp FROM matches WHERE short_id = ? ORDER BY played_at ASC'
      )
      .all(shortId) as unknown as MatchTimeRow[]
    const idleMs = this.getSessionIdleMs()

    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM sessions WHERE short_id = ?').run(shortId)
      const insert = this.db.prepare(
        `INSERT INTO sessions
          (short_id, started_at, ended_at, character, start_rating, end_rating, start_lp, end_lp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )

      let current: {
        start: number
        end: number
        lastCharacter: string | null
      } | null = null

      const flush = (): void => {
        if (!current) return
        const character = current.lastCharacter
        const startRating = character
          ? this.getFirstMatchRating(shortId, character, current.start, current.end, 'MR')
          : null
        const startLp = character
          ? this.getFirstMatchRating(shortId, character, current.start, current.end, 'LP')
          : null
        const endRating = character
          ? this.getFirstRatingAfter(shortId, 'MR', character, current.end)
          : null
        const endLp = character
          ? this.getFirstRatingAfter(shortId, 'LP', character, current.end)
          : null
        insert.run(
          shortId,
          current.start,
          current.end,
          character,
          startRating,
          endRating,
          startLp,
          endLp
        )
        current = null
      }

      for (const row of rows) {
        if (!current || row.played_at - current.end > idleMs) {
          flush()
          current = {
            start: row.played_at,
            end: row.played_at,
            lastCharacter: row.my_char
          }
        } else {
          current.end = row.played_at
          if (row.my_char !== null) current.lastCharacter = row.my_char
        }
      }

      flush()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  rebuildAllSessions(): void {
    for (const player of this.listPlayers()) {
      this.rebuildSessions(player.shortId)
    }
  }

  private getFirstMatchRating(
    shortId: string,
    character: string,
    from: number,
    to: number,
    kind: RatingPoint['kind']
  ): number | null {
    const column = kind === 'MR' ? 'my_mr' : 'my_lp'
    const row = this.db
      .prepare(
        `SELECT ${column} AS value FROM matches
         WHERE short_id = ? AND my_char = ? AND played_at >= ? AND played_at <= ?
           AND ${column} IS NOT NULL
         ORDER BY played_at ASC
         LIMIT 1`
      )
      .get(shortId, character, from, to) as { value: number } | undefined
    return row?.value ?? null
  }

  private getFirstRatingAfter(
    shortId: string,
    kind: RatingPoint['kind'],
    character: string,
    after: number
  ): number | null {
    const row = this.db
      .prepare(
        `SELECT value FROM rating_points
         WHERE short_id = ? AND kind = ? AND character = ? AND observed_at > ?
         ORDER BY observed_at ASC
         LIMIT 1`
      )
      .get(shortId, kind, character, after) as { value: number } | undefined
    return row?.value ?? null
  }

  listSessions(shortId: string): SessionSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE short_id = ? ORDER BY started_at ASC')
      .all(shortId) as unknown as SessionRow[]
    return rows.map((row) => this.toSessionSummary(row))
  }

  listSessionHistory(shortId: string, limit = 100): SessionHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM sessions WHERE short_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(shortId, Math.max(1, limit)) as unknown as SessionRow[]
    return rows.map((row) => ({
      ...this.toSessionSummary(row),
      startRating: row.start_rating,
      endRating: row.end_rating,
      startLp: row.start_lp,
      endLp: row.end_lp
    }))
  }

  getLatestSession(shortId: string): SessionSummary | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE short_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(shortId) as SessionRow | undefined
    if (!row) return null

    const session = this.toSessionSummary(row)
    const character = row.character ?? this.getLatestMatchCharacter(shortId)
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
        `INSERT INTO session_marks
           (short_id, started_at, character, start_mr, start_lp, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(short_id) DO UPDATE SET
           started_at = excluded.started_at,
           character = excluded.character,
           start_mr = excluded.start_mr,
           start_lp = excluded.start_lp,
           updated_at = excluded.updated_at`
      )
      .run(shortId, at, character, mr?.value ?? null, lp?.value ?? null, Date.now())

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

    const latest = this.db
      .prepare('SELECT MAX(played_at) AS played_at FROM matches WHERE short_id = ?')
      .get(shortId) as { played_at: number | null } | undefined
    const lastActivityAt = Math.max(mark.started_at, latest?.played_at ?? 0)
    if (Date.now() - lastActivityAt >= this.getSessionIdleMs()) {
      this.db.prepare('DELETE FROM session_marks WHERE short_id = ?').run(shortId)
      return null
    }

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

    const lastMatch = this.db
      .prepare(
        `SELECT my_char FROM matches
         WHERE short_id = ? AND played_at >= ?
         ORDER BY played_at DESC
         LIMIT 1`
      )
      .get(shortId, mark.started_at) as { my_char: string | null } | undefined
    const character = lastMatch?.my_char ?? mark.character ?? null
    const latestMr = character
      ? this.getLatestRating(shortId, 'MR', character)
      : this.getLatestRating(shortId, 'MR')
    const latestLp = character
      ? this.getLatestRating(shortId, 'LP', character)
      : this.getLatestRating(shortId, 'LP')
    const startMr =
      character !== null && mark.character !== character
        ? this.getFirstMatchRating(
            shortId,
            character,
            mark.started_at,
            Number.MAX_SAFE_INTEGER,
            'MR'
          )
        : mark.start_mr
    const startLp =
      character !== null && mark.character !== character
        ? this.getFirstMatchRating(
            shortId,
            character,
            mark.started_at,
            Number.MAX_SAFE_INTEGER,
            'LP'
          )
        : mark.start_lp

    return {
      shortId,
      startedAt: mark.started_at,
      endedAt: null,
      character,
      matches: Number(stats?.matches ?? 0),
      wins: Number(stats?.wins ?? 0),
      losses: Number(stats?.losses ?? 0),
      ratingDelta: startMr !== null && latestMr !== null ? latestMr.value - startMr : null,
      lpDelta: startLp !== null && latestLp !== null ? latestLp.value - startLp : null
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
      character: row.character,
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

  countMatches(query: string | MatchQuery): number {
    const filter = typeof query === 'string' ? { shortId: query } : query
    const { where, params } = matchFilter(filter)
    const row = this.db
      .prepare(`SELECT COUNT(*) AS total FROM matches WHERE ${where}`)
      .get(...params) as { total: number } | undefined
    return Number(row?.total ?? 0)
  }

  countRatingPoints(shortId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS total FROM rating_points WHERE short_id = ?')
      .get(shortId) as { total: number } | undefined
    return Number(row?.total ?? 0)
  }

  getCharacterStats(shortId: string): CharacterStat[] {
    const rows = this.db
      .prepare(
        `SELECT my_char AS character,
                COUNT(*) AS matches,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
                MAX(played_at) AS last_played_at
         FROM matches
         WHERE short_id = ? AND my_char IS NOT NULL
         GROUP BY my_char
         ORDER BY matches DESC, my_char ASC`
      )
      .all(shortId) as unknown as Array<{
      character: string
      matches: number
      wins: number
      losses: number
      last_played_at: number
    }>

    return rows.map((row) => {
      const matches = Number(row.matches)
      const wins = Number(row.wins)
      return {
        character: row.character,
        matches,
        wins,
        losses: Number(row.losses),
        winRate: matches > 0 ? wins / matches : 0,
        currentMr: this.getLatestRating(shortId, 'MR', row.character)?.value ?? null,
        currentLp: this.getLatestRating(shortId, 'LP', row.character)?.value ?? null,
        lastPlayedAt: row.last_played_at
      }
    })
  }

  getMatchupStats(shortId: string): MatchupStat[] {
    const rows = this.db
      .prepare(
        `SELECT opp_char AS character,
                COUNT(*) AS matches,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
                MAX(played_at) AS last_played_at
         FROM matches
         WHERE short_id = ? AND opp_char IS NOT NULL
         GROUP BY opp_char
         ORDER BY matches DESC, last_played_at DESC`
      )
      .all(shortId) as unknown as Array<{
      character: string
      matches: number
      wins: number
      losses: number
      last_played_at: number
    }>

    return rows.map((row) => {
      const matches = Number(row.matches)
      const wins = Number(row.wins)
      return {
        character: row.character,
        matches,
        wins,
        losses: Number(row.losses),
        winRate: matches > 0 ? wins / matches : 0,
        lastPlayedAt: row.last_played_at
      }
    })
  }

  getRivalStats(shortId: string, limit = 30): RivalStat[] {
    const rows = this.db
      .prepare(
        `SELECT m.opponent_id,
                COUNT(*) AS matches,
                SUM(CASE WHEN m.result = 'win' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN m.result = 'loss' THEN 1 ELSE 0 END) AS losses,
                MAX(m.played_at) AS last_played_at,
                (SELECT m2.result FROM matches m2
                 WHERE m2.short_id = m.short_id AND m2.opponent_id = m.opponent_id
                 ORDER BY m2.played_at DESC LIMIT 1) AS last_result
         FROM matches m
         WHERE m.short_id = ? AND m.opponent_id IS NOT NULL
         GROUP BY m.opponent_id
         ORDER BY matches DESC, last_played_at DESC
         LIMIT ?`
      )
      .all(shortId, Math.max(1, limit)) as unknown as Array<{
      opponent_id: string
      matches: number
      wins: number
      losses: number
      last_played_at: number
      last_result: RivalStat['lastResult']
    }>

    return rows.map((row) => {
      const matches = Number(row.matches)
      const wins = Number(row.wins)
      return {
        opponentId: row.opponent_id,
        matches,
        wins,
        losses: Number(row.losses),
        winRate: matches > 0 ? wins / matches : 0,
        lastPlayedAt: row.last_played_at,
        lastResult: row.last_result
      }
    })
  }

  getOpponentHistory(shortId: string, opponentId: string): OpponentHistory {
    const rows = this.db
      .prepare(
        `SELECT * FROM matches
         WHERE short_id = ? AND opponent_id = ?
         ORDER BY played_at ASC, replay_id ASC`
      )
      .all(shortId, opponentId) as unknown as MatchRow[]

    const seasons = new Map<string, OpponentSeason>()
    const charactersBySeason = new Map<string, Map<string, OpponentSeasonCharacter>>()
    let wins = 0
    let losses = 0

    for (const row of rows) {
      const date = new Date(row.played_at)
      const key = row.season
        ? `season:${row.season}`
        : `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      let season = seasons.get(key)
      let characterMap = charactersBySeason.get(key)
      if (!season || !characterMap) {
        season = {
          key,
          label: row.season
            ? `赛季 ${row.season}`
            : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`,
          season: row.season,
          matches: 0,
          wins: 0,
          losses: 0,
          firstPlayedAt: row.played_at,
          lastPlayedAt: row.played_at,
          characters: []
        }
        characterMap = new Map()
        seasons.set(key, season)
        charactersBySeason.set(key, characterMap)
      }

      season.matches += 1
      season.lastPlayedAt = row.played_at
      if (row.result === 'win') {
        season.wins += 1
        wins += 1
      } else if (row.result === 'loss') {
        season.losses += 1
        losses += 1
      }

      const name = row.opp_char ?? '未知角色'
      let character = characterMap.get(name)
      if (!character) {
        character = {
          character: name,
          matches: 0,
          wins: 0,
          losses: 0,
          mr: null,
          lp: null,
          lastPlayedAt: row.played_at
        }
        characterMap.set(name, character)
        season.characters.push(character)
      }
      character.matches += 1
      character.lastPlayedAt = row.played_at
      if (row.result === 'win') character.wins += 1
      if (row.result === 'loss') character.losses += 1
      if (row.opp_mr !== null) character.mr = row.opp_mr
      if (row.opp_lp !== null) character.lp = row.opp_lp
    }

    const seasonList = [...seasons.values()].sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    for (const season of seasonList) {
      season.characters.sort(
        (a, b) => b.matches - a.matches || b.lastPlayedAt - a.lastPlayedAt
      )
    }

    return {
      opponentId,
      matches: rows.length,
      wins,
      losses,
      firstPlayedAt: rows[0]?.played_at ?? 0,
      lastPlayedAt: rows[rows.length - 1]?.played_at ?? 0,
      seasons: seasonList
    }
  }

  getSeasonReport(shortId: string): SeasonStat[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM matches
         WHERE short_id = ?
         ORDER BY played_at ASC`
      )
      .all(shortId) as unknown as MatchRow[]

    const groups = new Map<string, SeasonStat>()
    for (const row of rows) {
      const date = new Date(row.played_at)
      const key = row.season
        ? `season:${row.season}`
        : `month:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      let group = groups.get(key)
      if (!group) {
        group = {
          key,
          label: row.season
            ? `赛季 ${row.season}`
            : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`,
          season: row.season,
          matches: 0,
          wins: 0,
          losses: 0,
          winRate: 0,
          firstPlayedAt: row.played_at,
          lastPlayedAt: row.played_at,
          startMr: null,
          endMr: null,
          startLp: null,
          endLp: null
        }
        groups.set(key, group)
      }
      group.matches += 1
      if (row.result === 'win') group.wins += 1
      if (row.result === 'loss') group.losses += 1
      group.lastPlayedAt = row.played_at
      if (row.my_mr !== null) {
        group.startMr ??= row.my_mr
        group.endMr = row.my_mr
      }
      if (row.my_lp !== null) {
        group.startLp ??= row.my_lp
        group.endLp = row.my_lp
      }
    }

    return [...groups.values()]
      .map((group) => ({
        ...group,
        winRate: group.matches > 0 ? group.wins / group.matches : 0
      }))
      .sort((a, b) => b.firstPlayedAt - a.firstPlayedAt)
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

function matchFilter(query: MatchQuery): { where: string; params: Array<string | number> } {
  const clauses = ['short_id = ?']
  const params: Array<string | number> = [query.shortId]
  if (query.character) {
    clauses.push('my_char = ?')
    params.push(query.character)
  }
  if (query.result) {
    clauses.push('result = ?')
    params.push(query.result)
  }
  if (query.kind === 'MR') clauses.push('my_mr IS NOT NULL')
  if (query.kind === 'LP') clauses.push('my_lp IS NOT NULL')
  if (query.from !== undefined) {
    clauses.push('played_at >= ?')
    params.push(query.from)
  }
  if (query.to !== undefined) {
    clauses.push('played_at <= ?')
    params.push(query.to)
  }
  return { where: clauses.join(' AND '), params }
}
