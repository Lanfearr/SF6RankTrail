import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { IpcApi, Match, UpdateCheckResult, UpdateProgress } from '../shared/types'

const api: IpcApi = {
  authLogin: (input) => ipcRenderer.invoke('auth:login', input),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  listPlayers: () => ipcRenderer.invoke('players:list'),
  addPlayer: (input) => ipcRenderer.invoke('players:add', input),
  removePlayer: (shortId) => ipcRenderer.invoke('players:remove', shortId),
  listMatches: (query) => ipcRenderer.invoke('matches:list', query),
  listMatchPage: (query) => ipcRenderer.invoke('matches:page', query),
  ratingSeries: (query) => ipcRenderer.invoke('ratings:series', query),
  dashboardList: () => ipcRenderer.invoke('dashboard:list'),
  characterStats: (shortId) => ipcRenderer.invoke('stats:characters', shortId),
  seasonReport: (shortId) => ipcRenderer.invoke('stats:seasons', shortId),
  sessionHistory: (shortId, limit) => ipcRenderer.invoke('sessions:history', shortId, limit),
  matchupStats: (shortId) => ipcRenderer.invoke('stats:matchups', shortId),
  rivalStats: (shortId, limit) => ipcRenderer.invoke('stats:rivals', shortId, limit),
  opponentHistory: (shortId, opponentId) =>
    ipcRenderer.invoke('opponents:history', shortId, opponentId),
  opponentSeasons: (opponentId) => ipcRenderer.invoke('opponents:seasons', opponentId),
  opponentLeagueInfo: (opponentId, seasonId, force) =>
    ipcRenderer.invoke('opponents:leagueInfo', opponentId, seasonId, force),
  openBucklerProfile: (shortId) => ipcRenderer.invoke('buckler:openProfile', shortId),
  diagnostics: (shortId) => ipcRenderer.invoke('diagnostics:get', shortId),
  refreshSession: (shortId) => ipcRenderer.invoke('session:refresh', shortId),
  rescanHistory: (shortId) => ipcRenderer.invoke('sync:rescan', shortId),
  syncStart: () => ipcRenderer.invoke('sync:start'),
  syncStop: () => ipcRenderer.invoke('sync:stop'),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: (force) => ipcRenderer.invoke('update:check', force),
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: UpdateProgress) => listener(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onUpdateAvailable: (listener) => {
    const handler = (_event: IpcRendererEvent, result: UpdateCheckResult) => listener(result)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  exportMatchesCsv: (shortId) => ipcRenderer.invoke('export:matchesCsv', shortId),
  exportDataJson: (shortId) => ipcRenderer.invoke('export:dataJson', shortId),
  importDataJson: () => ipcRenderer.invoke('import:dataJson'),
  backupDatabase: () => ipcRenderer.invoke('export:database'),
  runAutoBackup: () => ipcRenderer.invoke('backup:autoNow'),
  autoBackupStatus: () => ipcRenderer.invoke('backup:autoStatus'),
  openChart: () => ipcRenderer.send('chart:open'),
  openMatchDetail: (match) => ipcRenderer.send('match:openDetail', match),
  onMatchOpen: (listener) => {
    const handler = (_event: IpcRendererEvent, match: Match) => listener(match)
    ipcRenderer.on('match:open', handler)
    return () => ipcRenderer.removeListener('match:open', handler)
  },
  closeChart: () => ipcRenderer.send('chart:close'),
  chartSetMode: (mode) => ipcRenderer.send('chart:setMode', mode),
  chartSetAlwaysOnTop: (value) => ipcRenderer.send('chart:setAlwaysOnTop', value),
  chartSetOpacity: (value) => ipcRenderer.send('chart:setOpacity', value),
  getActivePlayer: () => ipcRenderer.invoke('active:get'),
  setActivePlayer: (shortId) => ipcRenderer.invoke('active:set', shortId),
  onActivePlayerChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, shortId: string | null) => listener(shortId)
    ipcRenderer.on('active:changed', handler)
    return () => ipcRenderer.removeListener('active:changed', handler)
  },
  onChartModeChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, mode: string) => listener(mode === 'pro' ? 'pro' : 'mini')
    ipcRenderer.on('chart:mode', handler)
    return () => ipcRenderer.removeListener('chart:mode', handler)
  },
  onChartAlwaysOnTopChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, value: boolean) => listener(Boolean(value))
    ipcRenderer.on('chart:alwaysOnTop', handler)
    return () => ipcRenderer.removeListener('chart:alwaysOnTop', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
