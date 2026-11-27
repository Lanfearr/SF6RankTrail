import type {
  CurrentRating,
  Match,
  MatchResult,
  OpponentFightAchievements,
  OpponentLeagueCharacter
} from '../../shared/types'

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

const pick = (obj: Json, keys: string[]): unknown => {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) return obj[key]
  }
  return undefined
}

const asString = (v: unknown): string | null => {
  if (typeof v === 'string' && v.length > 0) return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v)
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Math.round(Number(v))
  }
  return null
}

const asFloat = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v)
  }
  return null
}

const asTime = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v < 10_000_000_000 ? Math.round(v * 1000) : Math.round(v)
  }
  if (typeof v === 'string') {
    const parsed = Date.parse(v)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

const looksLikeBattle = (v: unknown): boolean => {
  if (!isObject(v)) return false
  const hasReplay = 'replay_id' in v || 'replayId' in v
  const hasPlayers = 'player1_info' in v || 'player2_info' in v || 'player1' in v || 'player2' in v
  return hasReplay && hasPlayers
}

export interface BattleLogPageInfo {
  totalPages: number | null
  currentPage: number | null
}

const readNumericField = (data: unknown, pattern: RegExp): number | null => {
  let found: number | null = null
  const seen = new Set<unknown>()

  const walk = (node: unknown, depth: number): void => {
    if (found !== null || depth > 8 || node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)

    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }

    for (const [key, value] of Object.entries(node as Json)) {
      if (pattern.test(key)) {
        const parsed = asNumber(value)
        if (parsed !== null && parsed > 0) {
          found = parsed
          return
        }
      }
      walk(value, depth + 1)
      if (found !== null) return
    }
  }

  walk(data, 0)
  return found
}

export function readBattleLogPageInfo(data: unknown): BattleLogPageInfo {
  return {
    totalPages: readNumericField(data, /^(?:total_?pages?|last_?pages?|max_?pages?|page_?count)$/i),
    currentPage: readNumericField(data, /^(?:current_?page|page_?no|page_?num)$/i)
  }
}

export function readPlayerName(data: unknown, expectedShortId?: string): string | null {
  if (!isObject(data)) return null
  const props = isObject(data.props) ? data.props : null
  const pageProps = props && isObject(props.pageProps) ? props.pageProps : data
  if (!isObject(pageProps)) return null
  const banner = pick(pageProps, ['fighter_banner_info', 'fighterBannerInfo'])
  if (!isObject(banner)) return null
  const info = pick(banner, ['personal_info', 'personalInfo'])
  if (!isObject(info)) return null
  const shortId = asString(pick(info, ['short_id', 'shortId']))
  if (expectedShortId && shortId && shortId !== expectedShortId) return null
  return asString(
    pick(info, [
      'fighter_id',
      'fighterId',
      'display_name',
      'displayName',
      'player_name',
      'playerName'
    ])
  )
}

export function parseCurrentRatings(data: unknown): CurrentRating[] {
  if (!isObject(data)) return []
  const props = isObject(data.props) ? data.props : data
  const pageProps = isObject(props.pageProps) ? props.pageProps : props
  const play = isObject(pageProps.play) ? pageProps.play : null
  const infos = play && Array.isArray(play.character_league_infos)
    ? play.character_league_infos
    : []

  const ratings: CurrentRating[] = []
  for (const info of infos) {
    if (!isObject(info) || info.is_played === false) continue
    const character = asString(pick(info, ['character_name', 'characterName']))
    const league = isObject(info.league_info) ? info.league_info : null
    if (!character || !league) continue
    const mr = asNumber(pick(league, ['master_rating', 'masterRating']))
    const lp = asNumber(pick(league, ['league_point', 'leaguePoint']))
    if ((mr === null || mr <= 0) && (lp === null || lp <= 0)) continue
    ratings.push({
      character,
      mr: mr !== null && mr > 0 ? mr : null,
      lp: lp !== null && lp > 0 ? lp : null
    })
  }
  return ratings
}

export interface PlayerSeasonInfo {
  currentSeasonId: number | null
  seasonIds: number[]
  achievements: OpponentFightAchievements | null
}

export function parseFightAchievements(play: unknown): OpponentFightAchievements | null {
  if (!isObject(play)) return null
  const stats = isObject(play.battle_stats) ? play.battle_stats : null
  if (!stats) return null

  const count = (key: string): number => asFloat(stats[key]) ?? 0
  const total = (key: string): number => asNumber(stats[key]) ?? 0

  return {
    trend: {
      driveGaugeRate: {
        driveParry: count('gauge_rate_drive_guard'),
        driveImpact: count('gauge_rate_drive_impact'),
        driveArts: count('gauge_rate_drive_arts'),
        driveRushFromParry: count('gauge_rate_drive_rush_from_parry'),
        driveRushFromCancel: count('gauge_rate_drive_rush_from_cancel'),
        driveReversal: count('gauge_rate_drive_reversal'),
        other: count('gauge_rate_drive_other')
      },
      driveReversalCount: count('drive_reversal'),
      driveParry: {
        success: count('drive_parry'),
        throwOpponent: count('throw_drive_parry'),
        receivedThrow: count('received_throw_drive_parry'),
        justParry: count('just_parry')
      },
      driveImpact: {
        success: count('drive_impact'),
        punishCounter: count('punish_counter'),
        clash: count('drive_impact_to_drive_impact'),
        received: count('received_drive_impact'),
        receivedPunishCounter: count('received_punish_counter'),
        receivedClash: count('received_drive_impact_to_drive_impact')
      },
      superArtsRate: {
        lv1: count('gauge_rate_sa_lv1'),
        lv2: count('gauge_rate_sa_lv2'),
        lv3: count('gauge_rate_sa_lv3'),
        ca: count('gauge_rate_ca')
      },
      stun: {
        dealt: count('stun'),
        received: count('received_stun')
      },
      throw: {
        success: count('throw_count'),
        received: count('received_throw_count'),
        tech: count('throw_tech')
      },
      corner: {
        opponentTime: count('corner_time'),
        selfTime: count('cornered_time')
      }
    },
    totals: {
      rankedMatches: total('rank_match_play_count'),
      casualMatches: total('casual_match_play_count'),
      customRoomMatches: total('custom_room_match_play_count'),
      battleHubMatches: total('battle_hub_match_play_count'),
      totalFightPoints: total('total_all_character_play_point'),
      challengeClearCount: total('target_clear_count')
    },
    rivalAi: {
      highestRank: asString(stats.rival_ai_highest_league_rank_txt),
      challengeCount: total('rival_ai_achieved_challenge_count')
    }
  }
}

export function parsePlayerSeasonInfo(data: unknown): PlayerSeasonInfo {
  if (!isObject(data)) return { currentSeasonId: null, seasonIds: [], achievements: null }
  const props = isObject(data.props) ? data.props : data
  const pageProps = isObject(props.pageProps) ? props.pageProps : props
  const play = isObject(pageProps.play) ? pageProps.play : null
  if (!play) return { currentSeasonId: null, seasonIds: [], achievements: null }

  const currentSeasonId = asNumber(pick(play, ['current_season_id', 'currentSeasonId']))
  const rawSeasonIds = pick(play, ['season_ids', 'seasonIds'])
  const seasonIds: number[] = []
  if (Array.isArray(rawSeasonIds)) {
    for (const raw of rawSeasonIds) {
      const id = asNumber(raw)
      if (id !== null && !seasonIds.includes(id)) seasonIds.push(id)
    }
  }
  return { currentSeasonId, seasonIds, achievements: parseFightAchievements(play) }
}

export function parseOpponentLeagueInfo(data: unknown): OpponentLeagueCharacter[] {
  if (!isObject(data)) return []
  const response = isObject(data.response) ? data.response : data
  const infos =
    (Array.isArray(response.character_league_infos) && response.character_league_infos) ||
    (Array.isArray(response.characterLeagueInfos) && response.characterLeagueInfos) ||
    []

  const characters: OpponentLeagueCharacter[] = []
  for (const info of infos) {
    if (!isObject(info) || info.is_played === false) continue
    const character = asString(pick(info, ['character_name', 'characterName']))
    const league = isObject(info.league_info) ? info.league_info : null
    if (!character || !league) continue
    const mr = asNumber(pick(league, ['master_rating', 'masterRating']))
    const lp = asNumber(pick(league, ['league_point', 'leaguePoint']))
    if ((mr === null || mr <= 0) && (lp === null || lp <= 0)) continue
    characters.push({
      character,
      mr: mr !== null && mr > 0 ? mr : null,
      lp: lp !== null && lp > 0 ? lp : null
    })
  }
  return characters
}

export function findBattleLogArrays(data: unknown): unknown[][] {
  const found: unknown[][] = []
  const seen = new Set<unknown>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      if (node.some(looksLikeBattle)) found.push(node)
      for (const item of node) walk(item)
      return
    }
    for (const value of Object.values(node as Json)) walk(value)
  }
  walk(data)
  return found
}

interface SideInfo {
  raw: Json
  shortId: string | null
  name: string | null
  character: string | null
  masterRating: number | null
  lp: number | null
  roundResults: number[]
}

const readSide = (raw: unknown): SideInfo | null => {
  if (!isObject(raw)) return null
  const info = isObject(raw.info) ? raw.info : raw
  const player = isObject(info.player) ? info.player : isObject(raw.player) ? raw.player : {}
  const roundsRaw = pick(info, ['round_results', 'roundResults'])
  const rounds = Array.isArray(roundsRaw)
    ? roundsRaw.map((r) => (typeof r === 'number' ? r : Number(r))).filter(Number.isFinite)
    : []
  return {
    raw: info,
    shortId: asString(pick(player, ['short_id', 'shortId'])),
    name: asString(pick(player, ['fighter_id', 'fighterId', 'display_name', 'displayName'])),
    character: asString(pick(info, ['character_name', 'characterName', 'character'])),
    masterRating: asNumber(pick(info, ['master_rating', 'masterRating'])),
    lp: asNumber(pick(info, ['league_point', 'leaguePoint', 'lp'])),
    roundResults: rounds
  }
}

const outcomeFor = (my: SideInfo, opp: SideInfo): MatchResult => {
  const myLosses = my.roundResults.filter((r) => r === 0).length
  const oppLosses = opp.roundResults.filter((r) => r === 0).length
  if (myLosses >= 2 && oppLosses < 2) return 'loss'
  if (oppLosses >= 2 && myLosses < 2) return 'win'
  return 'draw'
}

export function normalizeMatch(raw: unknown, ownerShortId: string): Match | null {
  if (!isObject(raw)) return null
  const replayId = asString(pick(raw, ['replay_id', 'replayId']))
  if (!replayId) return null

  const side1 = readSide(pick(raw, ['player1_info', 'player1Info', 'player1']))
  const side2 = readSide(pick(raw, ['player2_info', 'player2Info', 'player2']))
  if (!side1 || !side2) return null

  const ownerIsP1 = side1.shortId === ownerShortId
  const ownerIsP2 = side2.shortId === ownerShortId
  const me = ownerIsP1 || !ownerIsP2 ? side1 : side2
  const opp = me === side1 ? side2 : side1

  const playedAt = asTime(
    pick(raw, [
      'played_at',
      'playedAt',
      'battle_at',
      'battleAt',
      'replay_battle_at',
      'uploaded_at',
      'uploadedAt',
      'time'
    ])
  )

  return {
    replayId,
    shortId: ownerShortId,
    opponentId: opp.shortId,
    opponentName: opp.name,
    myChar: me.character,
    oppChar: opp.character,
    result: outcomeFor(me, opp),
    myMr: me.masterRating,
    oppMr: opp.masterRating,
    myLp: me.lp,
    oppLp: opp.lp,
    playedAt: playedAt ?? Date.now(),
    season: asString(pick(raw, ['season', 'season_id', 'seasonId'])),
    createdAt: Date.now()
  }
}

export function parseBattleLog(data: unknown, ownerShortId: string): Match[] {
  const arrays = findBattleLogArrays(data)
  const matches: Match[] = []
  for (const array of arrays) {
    for (const item of array) {
      const match = normalizeMatch(item, ownerShortId)
      if (match) matches.push(match)
    }
  }
  const dedup = new Map<string, Match>()
  for (const match of matches) dedup.set(match.replayId, match)
  return [...dedup.values()]
}
