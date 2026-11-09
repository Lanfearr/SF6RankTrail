import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type {
  AppSnapshot,
  AutoBackupStatus,
  ChartMode,
  Diagnostics,
  ExportResult,
  ImportResult,
  LoginResult,
  Match,
  MatchQuery,
  Player,
  PlayerInput,
  RatingPoint,
  RatingQuery,
  SyncStartResult,
  SyncStatus
} from '../shared/types'
import type { Db } from './db/migrate'
import { openDatabase } from './db/migrate'
import { Repository } from './db/repository'
import {
  closeActiveLogin,
  hasSavedSession,
  loginWithChrome,
  type LoginOptions
} from './collector/auth'
import { ElectronBucklerSource } from './collector/electron-fetcher'
import { SyncService } from './collector/sync-service'
import { RealtimeHub } from './server/realtime-hub'
import { OverlayServer } from './server/overlay-server'

const OVERLAY_PORT = 8765
const SYNC_INTERVAL_MS = 20_000
const MINI_SIZE = { width: 440, height: 340 }
const PRO_SIZE = { width: 960, height: 660 }
const AUTO_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000
const AUTO_BACKUP_RETENTION = 14

let mainWindow: BrowserWindow | null = null
let chartWindow: BrowserWindow | null = null
let repo: Repository
let database: Db
let dbPath = ''
let hub: RealtimeHub
let overlay: OverlayServer
let syncService: SyncService | null = null
let source: ElectronBucklerSource | null = null
let sessionPath = ''
let profileDir = ''
let loginInFlight = false
let quitting = false
let activeShortId: string | null = null
let syncStatus: SyncStatus = { state: 'idle', at: Date.now() }
let autoBackupTimer: ReturnType<typeof setInterval> | null = null
const statusHistory: SyncStatus[] = []

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

function setStatus(status: SyncStatus): void {
  syncStatus = status
  statusHistory.unshift(status)
  statusHistory.splice(20)
  hub?.broadcast({ type: 'sync:status', payload: status })
}

function resolveActiveShortId(): string | null {
  const players = repo.listPlayers()
  if (activeShortId && players.some((player) => player.shortId === activeShortId)) {
    return activeShortId
  }
  activeShortId = players.find((player) => player.isSelf)?.shortId ?? players[0]?.shortId ?? null
  return activeShortId
}

function broadcastActivePlayer(): void {
  const shortId = resolveActiveShortId()
  if (shortId) repo.setSetting('activeShortId', shortId)
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('active:changed', shortId)
  }
}

function currentSnapshot(): AppSnapshot {
  return {
    players: repo.listPlayers(),
    dashboards: repo.listDashboards(),
    sync: syncStatus,
    at: Date.now()
  }
}

function loadRenderer(window: BrowserWindow, page: 'index.html' | 'chart.html'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(`${devUrl.replace(/\/$/, '')}/${page}`)
  } else {
    void window.loadFile(join(__dirname, '../renderer', page))
  }
}

function readBounds(key: string, minWidth: number, minHeight: number): Electron.Rectangle | null {
  const raw = repo.getSetting(key)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<Electron.Rectangle>
    if (
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      typeof value.width !== 'number' ||
      typeof value.height !== 'number'
    ) {
      return null
    }
    return {
      x: value.x,
      y: value.y,
      width: Math.max(minWidth, value.width),
      height: Math.max(minHeight, value.height)
    }
  } catch {
    return null
  }
}

function saveBounds(key: string, window: BrowserWindow | null): void {
  if (!repo || !window || window.isDestroyed()) return
  repo.setSetting(key, JSON.stringify(window.getBounds()))
}

function mainBoundsKey(): string {
  return 'mainBounds'
}

function chartBoundsKey(mode: ChartMode): string {
  return mode === 'pro' ? 'chartProBounds' : 'chartMiniBounds'
}

function createMainWindow(): void {
  const saved = readBounds(mainBoundsKey(), 920, 620)
  mainWindow = new BrowserWindow({
    ...(saved ?? { width: 1080, height: 720 }),
    minWidth: 920,
    minHeight: 620,
    show: false,
    frame: true,
    backgroundColor: '#111116',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => saveBounds(mainBoundsKey(), mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
    if (!quitting) app.quit()
  })
  loadRenderer(mainWindow, 'index.html')
}

function chartMode(): ChartMode {
  return repo.getSetting('chartMode') === 'pro' ? 'pro' : 'mini'
}

function chartAlwaysOnTop(mode = chartMode()): boolean {
  const saved = repo.getSetting('chartAlwaysOnTop')
  if (saved === '1') return true
  if (saved === '0') return false
  return mode === 'mini'
}

function chartOpacity(): number {
  const raw = Number(repo.getSetting('chartOpacity') ?? '1')
  return Number.isFinite(raw) ? Math.min(1, Math.max(0.2, raw)) : 1
}

function createChartWindow(): void {
  if (chartWindow) {
    chartWindow.show()
    chartWindow.focus()
    return
  }

  const mode = chartMode()
  const size = mode === 'pro' ? PRO_SIZE : MINI_SIZE
  const saved = readBounds(chartBoundsKey(mode), 360, 300)
  chartWindow = new BrowserWindow({
    ...(saved ?? size),
    minWidth: 360,
    minHeight: 300,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: chartAlwaysOnTop(mode),
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  chartWindow.setOpacity(chartOpacity())
  chartWindow.on('ready-to-show', () => chartWindow?.show())
  chartWindow.on('close', () => {
    if (!quitting) saveBounds(chartBoundsKey(chartMode()), chartWindow)
  })
  chartWindow.on('closed', () => {
    chartWindow = null
  })
  loadRenderer(chartWindow, 'chart.html')
}

function applyChartMode(mode: ChartMode): void {
  const previousMode = chartMode()
  saveBounds(chartBoundsKey(previousMode), chartWindow)
  repo.setSetting('chartMode', mode)
  if (!chartWindow) return
  const alwaysOnTop = chartAlwaysOnTop(mode)
  chartWindow.setAlwaysOnTop(alwaysOnTop)
  const saved = readBounds(chartBoundsKey(mode), 360, 300)
  if (saved) {
    chartWindow.setBounds(saved)
  } else {
    chartWindow.setSize(
      mode === 'pro' ? PRO_SIZE.width : MINI_SIZE.width,
      mode === 'pro' ? PRO_SIZE.height : MINI_SIZE.height
    )
    chartWindow.center()
  }
  chartWindow.webContents.send('chart:mode', mode)
  chartWindow.webContents.send('chart:alwaysOnTop', alwaysOnTop)
}

function trackedShortIds(): string[] {
  return repo.listPlayers().map((player) => player.shortId)
}

function readSyncInterval(): number {
  const raw = Number(repo.getSetting('syncIntervalMs') ?? String(SYNC_INTERVAL_MS))
  if (!Number.isFinite(raw)) return SYNC_INTERVAL_MS
  return Math.max(15_000, Math.min(120_000, raw))
}

async function stopSync(): Promise<void> {
  syncService?.stop()
  syncService = null
  await source?.close()
  source = null
}

function startSync(): SyncStartResult {
  const shortIds = trackedShortIds()
  if (shortIds.length === 0) {
    return { ok: false, players: 0, message: '没有追踪账号，请先登录或添加账号' }
  }
  if (!hasSavedSession(sessionPath)) {
    return { ok: false, players: shortIds.length, message: '未登录，请先完成 CAPCOM ID 登录' }
  }

  syncService?.stop()
  void source?.close()
  source = new ElectronBucklerSource(sessionPath)
  syncService = new SyncService(repo, source, (event) => hub?.broadcast(event), setStatus)
  syncService.start(shortIds, readSyncInterval())
  return { ok: true, players: shortIds.length }
}

async function runLogin(input: PlayerInput): Promise<void> {
  if (loginInFlight) return
  loginInFlight = true
  setStatus({ state: 'syncing', at: Date.now(), message: '正在打开 Chrome…' })

  const options: LoginOptions = {
    expectedShortId: input.shortId ?? input.cfn,
    onProgress: (message) => setStatus({ state: 'syncing', at: Date.now(), message })
  }

  try {
    const result = await loginWithChrome(profileDir, sessionPath, options)
    const shortId = result.shortId ?? options.expectedShortId

    if (!result.ok || !shortId) {
      setStatus({
        state: 'error',
        at: Date.now(),
        message: result.message ?? '登录失败：未识别到账号'
      })
      return
    }

    repo.upsertPlayer({ shortId, cfn: input.cfn ?? shortId, isSelf: true })
    broadcastActivePlayer()
    setStatus({ state: 'idle', at: Date.now(), message: `登录成功：${shortId}` })
    startSync()
  } catch (error) {
    setStatus({
      state: 'error',
      at: Date.now(),
      message: error instanceof Error ? error.message : String(error)
    })
  } finally {
    loginInFlight = false
  }
}

async function chooseSavePath(
  defaultName: string,
  filters: Electron.FileFilter[]
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    defaultPath: join(app.getPath('documents'), defaultName),
    filters
  }
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

async function chooseOpenPath(filters: Electron.FileFilter[]): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    filters
  }
  const parent = BrowserWindow.getFocusedWindow() ?? mainWindow
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled) return null
  return result.filePaths[0] ?? null
}

function autoBackupDirectory(): string {
  return join(app.getPath('userData'), 'backups')
}

function listAutoBackupFiles(): string[] {
  try {
    return readdirSync(autoBackupDirectory())
      .filter((name) => name.startsWith('sf6scorer-') && name.endsWith('.db'))
      .sort()
  } catch {
    return []
  }
}

function autoBackupStatus(): AutoBackupStatus {
  const lastAt = Number(repo.getSetting('lastAutoBackupAt'))
  return {
    enabled: repo.getSetting('autoBackup') !== '0',
    directory: autoBackupDirectory(),
    files: listAutoBackupFiles().length,
    lastPath: repo.getSetting('lastAutoBackupPath'),
    lastAt: Number.isFinite(lastAt) && lastAt > 0 ? lastAt : null
  }
}

function runAutoBackup(force = false): ExportResult {
  try {
    if (!force && repo.getSetting('autoBackup') === '0') {
      return { ok: false, message: '自动备份已关闭' }
    }
    const directory = autoBackupDirectory()
    mkdirSync(directory, { recursive: true })
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const filePath = join(directory, `sf6scorer-${stamp}.db`)
    copyFileSync(dbPath, filePath)
    repo.setSetting('lastAutoBackupPath', filePath)
    repo.setSetting('lastAutoBackupAt', String(Date.now()))
    const files = listAutoBackupFiles()
    for (const old of files.slice(0, Math.max(0, files.length - AUTO_BACKUP_RETENTION))) {
      try {
        rmSync(join(directory, old), { force: true })
      } catch {
        // keep pruning even if an old backup cannot be removed
      }
    }
    return { ok: true, path: filePath }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

function scheduleAutoBackup(): void {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
  }
  if (!repo || repo.getSetting('autoBackup') === '0') return
  setTimeout(() => runAutoBackup(), 5_000)
  autoBackupTimer = setInterval(() => runAutoBackup(), AUTO_BACKUP_INTERVAL_MS)
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function matchesCsv(matches: Match[]): string {
  const header = [
    'replay_id',
    'played_at',
    'played_at_iso',
    'my_char',
    'opp_char',
    'result',
    'my_mr',
    'opp_mr',
    'my_lp',
    'season'
  ]
  const rows = matches.map((match) =>
    [
      match.replayId,
      match.playedAt,
      new Date(match.playedAt).toISOString(),
      match.myChar,
      match.oppChar,
      match.result,
      match.myMr,
      match.oppMr,
      match.myLp,
      match.season
    ]
      .map(csvCell)
      .join(',')
  )
  return `\uFEFF${header.join(',')}\r\n${rows.join('\r\n')}\r\n`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const optionalNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

function readImportFile(filePath: string): ImportResult {
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  if (!isRecord(raw) || !isRecord(raw['player'])) {
    throw new Error('不是有效的 SF6 Scorer JSON 备份')
  }
  const playerRaw = raw['player']
  const shortId = playerRaw['shortId']
  if (typeof shortId !== 'string' || shortId.length === 0) {
    throw new Error('备份缺少 player.shortId')
  }

  const player: Player = {
    shortId,
    cfn: optionalString(playerRaw['cfn']),
    displayName: optionalString(playerRaw['displayName']),
    isSelf: playerRaw['isSelf'] === true,
    lastSynced: optionalNumber(playerRaw['lastSynced']),
    createdAt: optionalNumber(playerRaw['createdAt']) ?? Date.now()
  }

  const matches: Match[] = []
  if (Array.isArray(raw['matches'])) {
    for (const entry of raw['matches']) {
      if (!isRecord(entry)) continue
      const result = entry['result']
      const playedAt = optionalNumber(entry['playedAt'])
      const replayId = entry['replayId']
      if (
        typeof replayId !== 'string' ||
        playedAt === null ||
        (result !== 'win' && result !== 'loss' && result !== 'draw')
      ) {
        continue
      }
      matches.push({
        replayId,
        shortId,
        opponentId: optionalString(entry['opponentId']),
        myChar: optionalString(entry['myChar']),
        oppChar: optionalString(entry['oppChar']),
        result,
        myMr: optionalNumber(entry['myMr']),
        oppMr: optionalNumber(entry['oppMr']),
        myLp: optionalNumber(entry['myLp']),
        playedAt,
        season: optionalString(entry['season']),
        createdAt: optionalNumber(entry['createdAt']) ?? playedAt
      })
    }
  }

  const ratings: RatingPoint[] = []
  const ratingsRaw = isRecord(raw['ratings']) ? raw['ratings'] : null
  const groups = ratingsRaw ? [ratingsRaw['MR'], ratingsRaw['LP']] : []
  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const entry of group) {
      if (!isRecord(entry)) continue
      const kind = entry['kind'] === 'MR' || entry['kind'] === 'LP' ? entry['kind'] : null
      const source =
        entry['source'] === 'battlelog' ||
        entry['source'] === 'snapshot' ||
        entry['source'] === 'manual'
          ? entry['source']
          : null
      const value = optionalNumber(entry['value'])
      const observedAt = optionalNumber(entry['observedAt'])
      if (!kind || !source || value === null || observedAt === null) continue
      ratings.push({
        id: optionalNumber(entry['id']) ?? 0,
        shortId,
        character: optionalString(entry['character']),
        kind,
        value,
        source,
        estimated: entry['estimated'] === true,
        observedAt
      })
    }
  }

  if (matches.length === 0 && ratings.length === 0) {
    throw new Error('备份中没有可导入的对局或分数数据')
  }

  const summary = repo.importPlayerData({ player, matches, ratings })
  broadcastActivePlayer()
  hub.broadcast({ type: 'snapshot', payload: currentSnapshot() })
  return { ok: true, path: filePath, summary }
}

function getDiagnostics(shortId: string): Diagnostics {
  const latest = repo.listMatches({ shortId, limit: 1 })[0]
  const session = repo.getActiveSession(shortId)
  return {
    shortId,
    loggedIn: hasSavedSession(sessionPath),
    counts: {
      players: repo.listPlayers().length,
      matches: repo.countMatches(shortId),
      ratingPoints: repo.countRatingPoints(shortId),
      sessions: repo.listSessions(shortId).length
    },
    lastSynced: repo.listPlayers().find((player) => player.shortId === shortId)?.lastSynced ?? null,
    latestMatchAt: latest?.playedAt ?? null,
    sessionStartedAt: session?.startedAt ?? null,
    recentStatuses: statusHistory
  }
}

function registerIpc(): void {
  ipcMain.handle('auth:login', async (_event, input: PlayerInput): Promise<LoginResult> => {
    void runLogin(input)
    return { ok: true, message: '正在打开 Chrome，请在窗口中完成登录' }
  })

  ipcMain.handle('auth:status', async () => {
    const self = repo.listPlayers().find((player) => player.isSelf)
    return { loggedIn: hasSavedSession(sessionPath), shortId: self?.shortId }
  })

  ipcMain.handle('players:list', async () => repo.listPlayers())

  ipcMain.handle('players:add', async (_event, input: PlayerInput) => {
    const shortId = input.shortId ?? input.cfn
    if (!shortId) return null
    const player = repo.upsertPlayer({
      shortId,
      cfn: input.cfn,
      displayName: input.displayName
    })
    broadcastActivePlayer()
    if (syncService?.isRunning() && hasSavedSession(sessionPath)) {
      startSync()
    }
    return player
  })

  ipcMain.handle('players:remove', async (_event, shortId: string) => {
    const removed = repo.deletePlayer(shortId)
    broadcastActivePlayer()
    if (repo.listPlayers().length === 0) {
      await stopSync()
      setStatus({ state: 'idle', at: Date.now(), message: '没有追踪账号' })
    } else if (syncService?.isRunning() && hasSavedSession(sessionPath)) {
      startSync()
    }
    return removed
  })

  ipcMain.handle('matches:list', async (_event, query: MatchQuery) => repo.listMatches(query))

  ipcMain.handle('matches:page', async (_event, query: MatchQuery) => ({
    matches: repo.listMatches(query),
    total: repo.countMatches(query)
  }))

  ipcMain.handle('ratings:series', async (_event, query: RatingQuery) => repo.listRatings(query))

  ipcMain.handle('dashboard:list', async () => repo.listDashboards())

  ipcMain.handle('stats:characters', async (_event, shortId: string) =>
    repo.getCharacterStats(shortId)
  )

  ipcMain.handle('stats:seasons', async (_event, shortId: string) => repo.getSeasonReport(shortId))

  ipcMain.handle('sessions:history', async (_event, shortId: string, limit?: number) =>
    repo.listSessionHistory(shortId, limit)
  )

  ipcMain.handle('stats:matchups', async (_event, shortId: string) =>
    repo.getMatchupStats(shortId)
  )

  ipcMain.handle('stats:rivals', async (_event, shortId: string, limit?: number) =>
    repo.getRivalStats(shortId, limit)
  )

  ipcMain.handle('diagnostics:get', async (_event, shortId: string) => getDiagnostics(shortId))

  ipcMain.handle('session:refresh', async (_event, shortId: string) => {
    if (!repo.listPlayers().some((player) => player.shortId === shortId)) return null
    const session = repo.startSession(shortId)
    hub.broadcast({ type: 'session:update', payload: session })
    if (syncService?.isRunning() && hasSavedSession(sessionPath)) {
      startSync()
    }
    return session
  })

  ipcMain.handle('sync:start', async (): Promise<SyncStartResult> => startSync())

  ipcMain.handle('sync:stop', async () => {
    await stopSync()
    setStatus({ state: 'idle', at: Date.now(), message: '已停止同步' })
  })

  ipcMain.handle('sync:status', async () => syncStatus)

  ipcMain.handle('settings:get', async (_event, key: string) => repo.getSetting(key))

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    repo.setSetting(key, value)
    if (key === 'syncIntervalMs' && syncService?.isRunning()) {
      startSync()
    }
    if (key === 'autoBackup') {
      scheduleAutoBackup()
    }
  })

  ipcMain.handle('export:matchesCsv', async (_event, shortId: string): Promise<ExportResult> => {
    try {
      const filePath = await chooseSavePath(`sf6-matches-${shortId}.csv`, [
        { name: 'CSV', extensions: ['csv'] }
      ])
      if (!filePath) return { ok: false, message: '已取消' }
      const matches = repo.listMatches({ shortId, limit: 1_000_000 })
      writeFileSync(filePath, matchesCsv(matches), 'utf8')
      return { ok: true, path: filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('export:dataJson', async (_event, shortId: string): Promise<ExportResult> => {
    try {
      const filePath = await chooseSavePath(`sf6-data-${shortId}.json`, [
        { name: 'JSON', extensions: ['json'] }
      ])
      if (!filePath) return { ok: false, message: '已取消' }
      const player = repo.listPlayers().find((entry) => entry.shortId === shortId) ?? null
      const payload = {
        exportedAt: Date.now(),
        player,
        matches: repo.listMatches({ shortId, limit: 1_000_000 }),
        ratings: {
          MR: repo.listRatings({ shortId, kind: 'MR' }),
          LP: repo.listRatings({ shortId, kind: 'LP' })
        },
        sessions: repo.listSessions(shortId)
      }
      writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('import:dataJson', async (): Promise<ImportResult> => {
    try {
      const filePath = await chooseOpenPath([{ name: 'JSON', extensions: ['json'] }])
      if (!filePath) return { ok: false, message: '已取消' }
      return readImportFile(filePath)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('backup:autoNow', async (): Promise<ExportResult> => runAutoBackup(true))

  ipcMain.handle('backup:autoStatus', async (): Promise<AutoBackupStatus> => autoBackupStatus())

  ipcMain.handle('export:database', async (): Promise<ExportResult> => {
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const filePath = await chooseSavePath(`sf6scorer-backup-${stamp}.db`, [
        { name: 'SQLite', extensions: ['db'] }
      ])
      if (!filePath) return { ok: false, message: '已取消' }
      database.exec('PRAGMA wal_checkpoint(TRUNCATE);')
      copyFileSync(dbPath, filePath)
      return { ok: true, path: filePath }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle('active:get', async () => resolveActiveShortId())

  ipcMain.handle('active:set', async (_event, shortId: string) => {
    if (!repo.listPlayers().some((player) => player.shortId === shortId)) return
    activeShortId = shortId
    repo.setSetting('activeShortId', shortId)
    broadcastActivePlayer()
  })

  ipcMain.on('chart:open', () => createChartWindow())

  ipcMain.on('chart:close', () => {
    chartWindow?.close()
  })

  ipcMain.on('chart:setMode', (_event, mode: ChartMode) => {
    applyChartMode(mode === 'pro' ? 'pro' : 'mini')
  })

  ipcMain.on('chart:setAlwaysOnTop', (_event, value: boolean) => {
    const enabled = Boolean(value)
    repo.setSetting('chartAlwaysOnTop', enabled ? '1' : '0')
    chartWindow?.setAlwaysOnTop(enabled)
    chartWindow?.webContents.send('chart:alwaysOnTop', enabled)
  })

  ipcMain.on('chart:setOpacity', (_event, value: number) => {
    const clamped = Math.min(1, Math.max(0.2, Number(value)))
    repo.setSetting('chartOpacity', String(clamped))
    chartWindow?.setOpacity(clamped)
  })
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  sessionPath = join(app.getPath('userData'), 'session.json')
  profileDir = join(app.getPath('userData'), 'chrome-profile')
  dbPath = join(app.getPath('userData'), 'sf6scorer.db')
  database = openDatabase(dbPath)
  repo = new Repository(database)
  activeShortId = repo.getSetting('activeShortId')
  resolveActiveShortId()
  hub = new RealtimeHub()
  overlay = new OverlayServer(OVERLAY_PORT)

  hub.setSnapshotProvider(currentSnapshot)
  hub.attach(overlay.server)

  try {
    await overlay.start()
  } catch (error) {
    console.error('overlay server failed:', error)
  }

  registerIpc()
  createMainWindow()
  scheduleAutoBackup()

  if (hasSavedSession(sessionPath) && repo.listPlayers().length > 0) {
    const result = startSync()
    if (!result.ok && result.message) {
      setStatus({ state: 'error', at: Date.now(), message: result.message })
    }
  }

  app.on('activate', () => {
    if (!mainWindow) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (quitting) return
  quitting = true
  if (repo) {
    saveBounds(mainBoundsKey(), mainWindow)
    saveBounds(chartBoundsKey(chartMode()), chartWindow)
  }
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer)
    autoBackupTimer = null
  }
  syncService?.stop()
  void source?.close()
  void closeActiveLogin()
  hub?.close()
  overlay?.stop()
  try {
    database?.close()
  } catch {
    // ignore shutdown close errors
  }
})
