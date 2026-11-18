export type MatchResult = 'win' | 'loss' | 'draw'
export type RatingKind = 'LP' | 'MR'
export type RatingSource = 'battlelog' | 'snapshot' | 'manual'
export type SyncState = 'idle' | 'syncing' | 'error'
export type ChartMode = 'mini' | 'pro'

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
  opponentName: string | null
  myChar: string | null
  oppChar: string | null
  result: MatchResult
  myMr: number | null
  oppMr: number | null
  myLp: number | null
  oppLp: number | null
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
  character: string | null
  matches: number
  wins: number
  losses: number
  ratingDelta: number | null
  lpDelta: number | null
}

export interface SessionHistoryEntry extends SessionSummary {
  startRating: number | null
  endRating: number | null
  startLp: number | null
  endLp: number | null
}

export interface MatchupStat {
  character: string
  matches: number
  wins: number
  losses: number
  winRate: number
  lastPlayedAt: number
}

export interface RivalStat {
  opponentId: string
  opponentName: string | null
  matches: number
  wins: number
  losses: number
  winRate: number
  lastPlayedAt: number
  lastResult: MatchResult
}

export interface CurrentRating {
  character: string | null
  mr: number | null
  lp: number | null
}

export interface RatingSnapshot {
  kind: RatingKind
  value: number
  character: string | null
  observedAt: number
}

export interface PlayerDashboard {
  player: Player
  latestMr: RatingSnapshot | null
  latestLp: RatingSnapshot | null
  session: SessionSummary | null
}

export interface SyncStatus {
  state: SyncState
  at: number
  message?: string
}

export interface AppSnapshot {
  players: Player[]
  dashboards: PlayerDashboard[]
  sync: SyncStatus
  at: number
}

export interface SyncWarning {
  shortId: string
  message: string
}

export type ServerEvent =
  | { type: 'match:new'; payload: Match }
  | { type: 'rating:update'; payload: RatingPoint }
  | { type: 'session:update'; payload: SessionSummary }
  | { type: 'sync:status'; payload: SyncStatus }
  | { type: 'sync:warning'; payload: SyncWarning }
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
  fullScan?: boolean
  fullScanError?: string
  oldestFetchedAt?: number
  newestFetchedAt?: number
}

export interface SyncStartResult {
  ok: boolean
  players: number
  message?: string
}

export interface PlayerInput {
  cfn?: string
  shortId?: string
  displayName?: string
}

export interface MatchQuery {
  shortId: string
  limit?: number
  offset?: number
  character?: string | null
  result?: MatchResult | null
  kind?: RatingKind | null
  from?: number
  to?: number
}

export interface MatchPage {
  matches: Match[]
  total: number
}

export interface OpponentSeasonCharacter {
  character: string
  matches: number
  wins: number
  losses: number
  mr: number | null
  lp: number | null
  lastPlayedAt: number
}

export interface OpponentSeason {
  key: string
  label: string
  season: string | null
  matches: number
  wins: number
  losses: number
  firstPlayedAt: number
  lastPlayedAt: number
  characters: OpponentSeasonCharacter[]
}

export interface OpponentHistory {
  opponentId: string
  matches: number
  wins: number
  losses: number
  firstPlayedAt: number
  lastPlayedAt: number
  seasons: OpponentSeason[]
}

export interface OpponentSeasonSummary {
  opponentId: string
  currentSeasonId: number | null
  seasonIds: number[]
}

export interface OpponentLeagueCharacter {
  character: string
  mr: number | null
  lp: number | null
}

export interface OpponentLeagueInfo {
  opponentId: string
  seasonId: number
  characters: OpponentLeagueCharacter[]
  fetchedAt: number
  cached: boolean
}

export interface CharacterStat {
  character: string
  matches: number
  wins: number
  losses: number
  winRate: number
  currentMr: number | null
  currentLp: number | null
  lastPlayedAt: number | null
}

export interface SeasonStat {
  key: string
  label: string
  season: string | null
  matches: number
  wins: number
  losses: number
  winRate: number
  firstPlayedAt: number
  lastPlayedAt: number
  startMr: number | null
  endMr: number | null
  startLp: number | null
  endLp: number | null
}

export interface Diagnostics {
  shortId: string
  loggedIn: boolean
  counts: {
    players: number
    matches: number
    ratingPoints: number
    sessions: number
  }
  lastSynced: number | null
  latestMatchAt: number | null
  sessionStartedAt: number | null
  recentStatuses: SyncStatus[]
}

export interface ExportResult {
  ok: boolean
  path?: string
  message?: string
}

export interface ImportSummary {
  matches: number
  ratings: number
  skippedMatches: number
  skippedRatings: number
}

export interface ImportResult extends ExportResult {
  summary?: ImportSummary
}

export interface AutoBackupStatus {
  enabled: boolean
  directory: string
  files: number
  lastPath: string | null
  lastAt: number | null
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
  removePlayer: (shortId: string) => Promise<boolean>
  listMatches: (query: MatchQuery) => Promise<Match[]>
  listMatchPage: (query: MatchQuery) => Promise<MatchPage>
  ratingSeries: (query: RatingQuery) => Promise<RatingPoint[]>
  dashboardList: () => Promise<PlayerDashboard[]>
  characterStats: (shortId: string) => Promise<CharacterStat[]>
  seasonReport: (shortId: string) => Promise<SeasonStat[]>
  sessionHistory: (shortId: string, limit?: number) => Promise<SessionHistoryEntry[]>
  matchupStats: (shortId: string) => Promise<MatchupStat[]>
  rivalStats: (shortId: string, limit?: number) => Promise<RivalStat[]>
  opponentHistory: (shortId: string, opponentId: string) => Promise<OpponentHistory>
  opponentSeasons: (opponentId: string) => Promise<OpponentSeasonSummary>
  opponentLeagueInfo: (
    opponentId: string,
    seasonId: number,
    force?: boolean
  ) => Promise<OpponentLeagueInfo>
  diagnostics: (shortId: string) => Promise<Diagnostics>
  refreshSession: (shortId: string) => Promise<SessionSummary | null>
  rescanHistory: (shortId: string) => Promise<SyncResult>
  syncStart: () => Promise<SyncStartResult>
  syncStop: () => Promise<void>
  syncStatus: () => Promise<SyncStatus>
  getVersion: () => Promise<string>
  getSetting: (key: string) => Promise<string | null>
  setSetting: (key: string, value: string) => Promise<void>
  exportMatchesCsv: (shortId: string) => Promise<ExportResult>
  exportDataJson: (shortId: string) => Promise<ExportResult>
  importDataJson: () => Promise<ImportResult>
  backupDatabase: () => Promise<ExportResult>
  runAutoBackup: () => Promise<ExportResult>
  autoBackupStatus: () => Promise<AutoBackupStatus>
  openChart: () => void
  openMatchDetail: (match: Match) => void
  onMatchOpen: (listener: (match: Match) => void) => () => void
  closeChart: () => void
  chartSetMode: (mode: ChartMode) => void
  chartSetAlwaysOnTop: (value: boolean) => void
  chartSetOpacity: (value: number) => void
  getActivePlayer: () => Promise<string | null>
  setActivePlayer: (shortId: string) => Promise<void>
  onActivePlayerChanged: (listener: (shortId: string | null) => void) => () => void
  onChartModeChanged: (listener: (mode: ChartMode) => void) => () => void
  onChartAlwaysOnTopChanged: (listener: (value: boolean) => void) => () => void
}
