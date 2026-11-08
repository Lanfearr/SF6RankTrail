import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import type {
  LoginResult,
  MatchQuery,
  PlayerInput,
  RatingQuery,
  SyncStartResult,
  SyncStatus
} from '../shared/types'
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

let mainWindow: BrowserWindow | null = null
let repo: Repository
let hub: RealtimeHub
let overlay: OverlayServer
let syncService: SyncService | null = null
let source: ElectronBucklerSource | null = null
let sessionPath = ''
let profileDir = ''
let loginInFlight = false
let syncStatus: SyncStatus = { state: 'idle', at: Date.now() }

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
  hub?.broadcast({ type: 'sync:status', payload: status })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 340,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
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
    if (syncService?.isRunning() && hasSavedSession(sessionPath)) {
      startSync()
    }
    return player
  })

  ipcMain.handle('players:remove', async (_event, shortId: string) => {
    const removed = repo.deletePlayer(shortId)
    if (repo.listPlayers().length === 0) {
      await stopSync()
      setStatus({ state: 'idle', at: Date.now(), message: '没有追踪账号' })
    } else if (syncService?.isRunning() && hasSavedSession(sessionPath)) {
      startSync()
    }
    return removed
  })

  ipcMain.handle('matches:list', async (_event, query: MatchQuery) => repo.listMatches(query))

  ipcMain.handle('ratings:series', async (_event, query: RatingQuery) => repo.listRatings(query))

  ipcMain.handle('dashboard:list', async () => repo.listDashboards())

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
  })

  ipcMain.on('window:setAlwaysOnTop', (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(Boolean(value))
  })

  ipcMain.on('window:setOpacity', (_event, value: number) => {
    if (!mainWindow) return
    const clamped = Math.min(1, Math.max(0.2, Number(value)))
    mainWindow.setOpacity(clamped)
  })

  ipcMain.on('window:setMode', (_event, mode: 'mini' | 'pro') => {
    if (!mainWindow) return
    if (mode === 'pro') {
      mainWindow.setAlwaysOnTop(false)
      mainWindow.setSize(960, 660)
    } else {
      mainWindow.setAlwaysOnTop(true)
      mainWindow.setSize(440, 340)
    }
    mainWindow.center()
  })
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  sessionPath = join(app.getPath('userData'), 'session.json')
  profileDir = join(app.getPath('userData'), 'chrome-profile')
  const db = openDatabase(join(app.getPath('userData'), 'sf6scorer.db'))
  repo = new Repository(db)
  hub = new RealtimeHub()
  overlay = new OverlayServer(OVERLAY_PORT)

  hub.setSnapshotProvider(() => ({
    players: repo.listPlayers(),
    dashboards: repo.listDashboards(),
    sync: syncStatus,
    at: Date.now()
  }))
  hub.attach(overlay.server)

  try {
    await overlay.start()
  } catch (error) {
    console.error('overlay server failed:', error)
  }

  registerIpc()
  createWindow()

  if (hasSavedSession(sessionPath) && repo.listPlayers().length > 0) {
    const result = startSync()
    if (!result.ok && result.message) {
      setStatus({ state: 'error', at: Date.now(), message: result.message })
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  syncService?.stop()
  void source?.close()
  void closeActiveLogin()
  hub?.close()
  overlay?.stop()
})
