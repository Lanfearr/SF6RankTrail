export type MatchResult = 'win' | 'loss' | 'draw'
export type RatingKind = 'LP' | 'MR'
export type RatingSource = 'battlelog' | 'snapshot' | 'manual'
export type SyncState = 'idle' | 'syncing' | 'error'

export interface Player {
  shortId: string
  cfn: string | null
  displayName: string | null
  isSelf: boolean
  lastSynced: number | null
  createdAt: number
}

export interface Match {
  replayId: string
  shortId: string
  opponentId: string | null
  myChar: string | null
  oppChar: string | null
  result: MatchResult
  myMr: number | null
  oppMr: number | null
  myLp: number | null
  playedAt: number
  season: string | null
  createdAt: number
}

export interface RatingPoint {
  id: number
  shortId: string
  character: string | null
  kind: RatingKind
  value: number
  source: RatingSource
  estimated: boolean
  observedAt: number
}

export interface SessionSummary {
  shortId: string
  startedAt: number
  endedAt: number | null
  matches: number
  wins: number
  losses: number
  ratingDelta: number | null
}

export interface SyncStatus {
  state: SyncState
  at: number
  message?: string
}

export interface AppSnapshot {
  players: Player[]
  sync: SyncStatus
  at: number
}

export type ServerEvent =
  | { type: 'match:new'; payload: Match }
  | { type: 'rating:update'; payload: RatingPoint }
  | { type: 'session:update'; payload: SessionSummary }
  | { type: 'sync:status'; payload: SyncStatus }
  | { type: 'snapshot'; payload: AppSnapshot }

export interface LoginResult {
  ok: boolean
  shortId?: string
  message?: string
}

export interface SyncResult {
  shortId: string
  fetched: number
  inserted: number
}

export interface SyncStartResult {
  ok: boolean
  players: number
  message?: string
}

export interface PlayerInput {
  cfn?: string
  shortId?: string
}

export interface MatchQuery {
  shortId: string
  limit?: number
  offset?: number
}

export interface RatingQuery {
  shortId: string
  kind: RatingKind
  from?: number
  to?: number
}

export interface IpcApi {
  authLogin: (input: PlayerInput) => Promise<LoginResult>
  authStatus: () => Promise<{ loggedIn: boolean; shortId?: string }>
  listPlayers: () => Promise<Player[]>
  addPlayer: (input: PlayerInput) => Promise<Player | null>
  listMatches: (query: MatchQuery) => Promise<Match[]>
  ratingSeries: (query: RatingQuery) => Promise<RatingPoint[]>
  syncStart: () => Promise<SyncStartResult>
  syncStop: () => Promise<void>
  syncStatus: () => Promise<SyncStatus>
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  setAlwaysOnTop: (value: boolean) => void
  setOpacity: (value: number) => void
}
