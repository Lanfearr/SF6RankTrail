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
import { loginInteractively, readStorageState } from './collector/auth'
import { BattleLogSource } from './collector/fetcher'
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
let source: BattleLogSource | null = null
let statePath = ''
let syncStatus: SyncStatus = { state: 'idle', at: Date.now() }

function setStatus(status: SyncStatus): void {
  syncStatus = status
  hub?.broadcast({ type: 'sync:status', payload: status })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 320,
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
  if (!readStorageState(statePath)) {
    return { ok: false, players: shortIds.length, message: '未登录，请先完成 CAPCOM ID 登录' }
  }

  syncService?.stop()
  void source?.close()
  source = new BattleLogSource(statePath)
  syncService = new SyncService(
    repo,
    source,
    (event) => hub?.broadcast(event),
    setStatus
  )
  syncService.start(shortIds, SYNC_INTERVAL_MS)
  return { ok: true, players: shortIds.length }
}

async function runLogin(input: PlayerInput): Promise<void> {
  setStatus({ state: 'syncing', at: Date.now(), message: '请在打开的浏览器中完成登录' })
  try {
    const expectedShortId = input.shortId ?? input.cfn
    const result = await loginInteractively(statePath, { expectedShortId })
    const shortId = result.shortId ?? expectedShortId

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
  }
}

function registerIpc(): void {
  ipcMain.handle('auth:login', async (_event, input: PlayerInput): Promise<LoginResult> => {
    void runLogin(input)
    return { ok: true, message: '已打开登录窗口，请在浏览器中完成登录' }
  })

  ipcMain.handle('auth:status', async () => {
    const self = repo.listPlayers().find((player) => player.isSelf)
    return { loggedIn: Boolean(self) && readStorageState(statePath), shortId: self?.shortId }
  })

  ipcMain.handle('players:list', async () => repo.listPlayers())

  ipcMain.handle('players:add', async (_event, input: PlayerInput) => {
    const shortId = input.shortId ?? input.cfn
    if (!shortId) return null
    const player = repo.upsertPlayer({ shortId, cfn: input.cfn })
    if (syncService?.isRunning() && readStorageState(statePath)) {
      startSync()
    }
    return player
  })

  ipcMain.handle('matches:list', async (_event, query: MatchQuery) => repo.listMatches(query))

  ipcMain.handle('ratings:series', async (_event, query: RatingQuery) => repo.listRatings(query))

  ipcMain.handle('sync:start', async (): Promise<SyncStartResult> => startSync())

  ipcMain.handle('sync:stop', async () => {
    await stopSync()
    setStatus({ state: 'idle', at: Date.now(), message: '已停止同步' })
  })

  ipcMain.handle('sync:status', async () => syncStatus)

  ipcMain.handle('settings:get', async (_event, key: string) => repo.getSetting(key))

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    repo.setSetting(key, value)
  })

  ipcMain.on('window:setAlwaysOnTop', (_event, value: boolean) => {
    mainWindow?.setAlwaysOnTop(Boolean(value))
  })

  ipcMain.on('window:setOpacity', (_event, value: number) => {
    if (!mainWindow) return
    const clamped = Math.min(1, Math.max(0.2, Number(value)))
    mainWindow.setOpacity(clamped)
  })
}

app.whenReady().then(async () => {
  statePath = join(app.getPath('userData'), 'storage.json')
  const db = openDatabase(join(app.getPath('userData'), 'sf6scorer.db'))
  repo = new Repository(db)
  hub = new RealtimeHub()
  overlay = new OverlayServer(OVERLAY_PORT)

  hub.setSnapshotProvider(() => ({
    players: repo.listPlayers(),
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

  if (readStorageState(statePath) && repo.listPlayers().length > 0) {
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
  hub?.close()
  overlay?.stop()
})
