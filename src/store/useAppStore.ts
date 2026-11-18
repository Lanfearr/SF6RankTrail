import { create } from 'zustand'
import type {
  AppSnapshot,
  LoginResult,
  Player,
  PlayerDashboard,
  ServerEvent,
  SessionSummary,
  SyncStartResult,
  SyncStatus
} from '@shared/types'

interface AppStore {
  players: Player[]
  dashboards: PlayerDashboard[]
  sync: SyncStatus
  activeShortId: string | null
  lastEvent: string
  warning: string | null
  refresh: () => Promise<void>
  addPlayer: (value: string, displayName?: string) => Promise<Player | null>
  removePlayer: (shortId: string) => Promise<boolean>
  refreshSession: (shortId: string) => Promise<SessionSummary | null>
  login: () => Promise<LoginResult>
  start: () => Promise<SyncStartResult>
  stop: () => Promise<void>
  setSnapshot: (snapshot: AppSnapshot) => void
  applyEvent: (event: ServerEvent) => void
  setPlayers: (players: Player[]) => void
  setDashboards: (dashboards: PlayerDashboard[]) => void
  setActive: (shortId: string) => void
  setActiveLocal: (shortId: string | null) => void
  setSync: (sync: SyncStatus) => void
  setLastEvent: (message: string) => void
  clearWarning: () => void
}

const pickActive = (players: Player[]): string | null => {
  const self = players.find((player) => player.isSelf)
  return (self ?? players[0])?.shortId ?? null
}

const withDashboardUpdate = (
  dashboards: PlayerDashboard[],
  shortId: string,
  updater: (dashboard: PlayerDashboard) => PlayerDashboard
): PlayerDashboard[] =>
  dashboards.map((dashboard) =>
    dashboard.player.shortId === shortId ? updater(dashboard) : dashboard
  )

export const useAppStore = create<AppStore>((set, get) => ({
  players: [],
  dashboards: [],
  sync: { state: 'idle', at: Date.now() },
  activeShortId: null,
  lastEvent: '就绪',
  warning: null,

  refresh: async () => {
    const [players, dashboards, sync, active] = await Promise.all([
      window.api.listPlayers(),
      window.api.dashboardList(),
      window.api.syncStatus(),
      window.api.getActivePlayer()
    ])
    set((state) => ({
      players,
      dashboards,
      sync,
      activeShortId:
        active && players.some((player) => player.shortId === active)
          ? active
          : state.activeShortId &&
              players.some((player) => player.shortId === state.activeShortId)
            ? state.activeShortId
            : pickActive(players)
    }))
  },

  addPlayer: async (value, displayName) => {
    const player = await window.api.addPlayer({ cfn: value, displayName })
    await get().refresh()
    return player
  },

  removePlayer: async (shortId) => {
    const removed = await window.api.removePlayer(shortId)
    set({ warning: null })
    await get().refresh()
    return removed
  },

  refreshSession: async (shortId) => {
    const session = await window.api.refreshSession(shortId)
    await get().refresh()
    set({ lastEvent: '已开始新的本次会话' })
    return session
  },

  login: async () => {
    const result = await window.api.authLogin({})
    await get().refresh()
    return result
  },

  start: async () => {
    const result = await window.api.syncStart()
    await get().refresh()
    return result
  },

  stop: async () => {
    await window.api.syncStop()
    await get().refresh()
  },

  setSnapshot: (snapshot) =>
    set((state) => ({
      players: snapshot.players,
      dashboards: snapshot.dashboards,
      sync: snapshot.sync,
      activeShortId:
        state.activeShortId &&
        snapshot.players.some((player) => player.shortId === state.activeShortId)
          ? state.activeShortId
          : pickActive(snapshot.players)
    })),

  applyEvent: (event) => {
    switch (event.type) {
      case 'snapshot':
        get().setSnapshot(event.payload)
        return
      case 'sync:status':
        set({ sync: event.payload })
        return
      case 'sync:warning':
        set({ warning: event.payload.message })
        return
      case 'rating:update': {
        const point = event.payload
        set((state) => ({
          dashboards: withDashboardUpdate(state.dashboards, point.shortId, (dashboard) => ({
            ...dashboard,
            latestMr:
              point.kind === 'MR'
                ? {
                    kind: 'MR',
                    value: point.value,
                    character: point.character,
                    observedAt: point.observedAt
                  }
                : dashboard.latestMr,
            latestLp:
              point.kind === 'LP'
                ? {
                    kind: 'LP',
                    value: point.value,
                    character: point.character,
                    observedAt: point.observedAt
                  }
                : dashboard.latestLp
          })),
          lastEvent: `${point.kind} ${point.value.toLocaleString()}`
        }))
        return
      }
      case 'session:update': {
        const session = event.payload
        set((state) => ({
          dashboards: withDashboardUpdate(state.dashboards, session.shortId, (dashboard) => ({
            ...dashboard,
            session
          }))
        }))
        return
      }
      case 'match:new': {
        const match = event.payload
        const label = match.result === 'win' ? '胜' : match.result === 'loss' ? '负' : '平'
        set({ lastEvent: `新对局 ${label} · ${match.myChar ?? '?'}` })
      }
    }
  },

  setPlayers: (players) =>
    set((state) => ({
      players,
      activeShortId:
        state.activeShortId && players.some((player) => player.shortId === state.activeShortId)
          ? state.activeShortId
          : pickActive(players)
    })),
  setDashboards: (dashboards) => set({ dashboards }),
  setActive: (activeShortId) => {
    set({ activeShortId })
    void window.api.setActivePlayer(activeShortId)
  },
  setActiveLocal: (activeShortId) => set({ activeShortId }),
  setSync: (sync) => set({ sync }),
  setLastEvent: (lastEvent) => set({ lastEvent }),
  clearWarning: () => set({ warning: null })
}))
