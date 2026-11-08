import { contextBridge, ipcRenderer } from 'electron'
import type { IpcApi } from '../shared/types'

const api: IpcApi = {
  authLogin: (input) => ipcRenderer.invoke('auth:login', input),
  authStatus: () => ipcRenderer.invoke('auth:status'),
  listPlayers: () => ipcRenderer.invoke('players:list'),
  addPlayer: (input) => ipcRenderer.invoke('players:add', input),
  listMatches: (query) => ipcRenderer.invoke('matches:list', query),
  ratingSeries: (query) => ipcRenderer.invoke('ratings:series', query),
  syncStart: () => ipcRenderer.invoke('sync:start'),
  syncStop: () => ipcRenderer.invoke('sync:stop'),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  setAlwaysOnTop: (value) => ipcRenderer.send('window:setAlwaysOnTop', value),
  setOpacity: (value) => ipcRenderer.send('window:setOpacity', value)
}

contextBridge.exposeInMainWorld('api', api)
