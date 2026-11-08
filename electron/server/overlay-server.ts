import express from 'express'
import { createServer, type Server } from 'node:http'

const overlayHtml = (port: number): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>SF6 Scorer Overlay</title>
    <style>
      html, body { margin: 0; background: transparent; overflow: hidden; }
      body { font-family: system-ui, sans-serif; color: #fff; }
      #root { padding: 8px 12px; }
      .card {
        display: inline-flex; gap: 16px; align-items: center;
        background: rgba(15, 15, 20, 0.72); border-radius: 12px;
        padding: 10px 16px; backdrop-filter: blur(6px);
      }
      .label { font-size: 11px; opacity: 0.6; text-transform: uppercase; }
      .value { font-size: 20px; font-weight: 700; }
      .muted { opacity: 0.5; font-size: 12px; }
    </style>
  </head>
  <body>
    <div id="root"><div class="card"><span class="muted">等待数据…</span></div></div>
    <script>
      const root = document.getElementById('root')
      const socket = new WebSocket('ws://127.0.0.1:${port}/ws')
      socket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data)
          const payload = data.payload || {}
          if (data.type === 'rating:update') {
            root.innerHTML = '<div class="card"><div><div class="label">' +
              (payload.kind || '') + '</div><div class="value">' + payload.value + '</div></div></div>'
          } else if (data.type === 'match:new') {
            const sign = payload.result === 'win' ? '+' : '-'
            root.innerHTML = '<div class="card"><div><div class="label">最近对局</div>' +
              '<div class="value">' + sign + ' ' + (payload.myChar || '') + '</div></div></div>'
          }
        } catch (error) {
          console.error(error)
        }
      })
    </script>
  </body>
</html>`

export class OverlayServer {
  readonly server: Server

  constructor(private readonly port: number) {
    const app = express()
    app.get('/health', (_req, res) => res.json({ ok: true }))
    app.get('/overlay', (_req, res) => res.type('html').send(overlayHtml(this.port)))
    this.server = createServer(app)
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', () => resolve())
    })
  }

  stop(): void {
    this.server.close()
  }
}
