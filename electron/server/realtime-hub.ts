import type { Server } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { AppSnapshot, ServerEvent } from '../../shared/types'

const emptySnapshot = (): AppSnapshot => ({
  players: [],
  dashboards: [],
  sync: { state: 'idle', at: Date.now() },
  at: Date.now()
})

export class RealtimeHub {
  private wss: WebSocketServer | null = null
  private snapshotProvider: () => AppSnapshot = emptySnapshot

  attach(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' })
    this.wss.on('connection', (socket) => {
      const event: ServerEvent = { type: 'snapshot', payload: this.snapshotProvider() }
      socket.send(JSON.stringify(event))
    })
  }

  setSnapshotProvider(provider: () => AppSnapshot): void {
    this.snapshotProvider = provider
  }

  broadcast(event: ServerEvent): void {
    if (!this.wss) return
    const data = JSON.stringify(event)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data)
    }
  }

  close(): void {
    this.wss?.close()
    this.wss = null
  }
}
