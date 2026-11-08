import express from 'express'
import { createServer, type Server } from 'node:http'

const overlayHtml = (port: number): string => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>SF6 Scorer Overlay</title>
    <style>
      html, body { margin: 0; background: transparent; overflow: hidden; }
      body { font-family: system-ui, 'Segoe UI', sans-serif; color: #fff; }
      #root { padding: 6px; display: inline-block; }
      .card {
        display: inline-flex; gap: 18px; align-items: center;
        background: rgba(15, 15, 20, 0.74); border-radius: 12px;
        padding: 10px 16px; backdrop-filter: blur(6px);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      .name { font-size: 11px; opacity: 0.65; margin-bottom: 2px; }
      .rating { display: flex; align-items: baseline; gap: 8px; }
      .kind { font-size: 11px; letter-spacing: 1.5px; opacity: 0.6; }
      .value { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
      .delta { font-size: 12px; opacity: 0.8; }
      .delta.up { color: #34d399; }
      .delta.down { color: #f87171; }
      .side { display: flex; flex-direction: column; gap: 3px; font-size: 12px; }
      .side div { display: flex; gap: 6px; justify-content: space-between; }
      .label { opacity: 0.55; }
      .muted { opacity: 0.55; font-size: 12px; }
    </style>
  </head>
  <body>
    <div id="root"><span class="muted" style="padding:8px">等待数据…</span></div>
    <script>
      const params = new URLSearchParams(location.search)
      const wanted = (params.get('player') || '').toLowerCase()
      const preferred = (params.get('mode') || 'auto').toLowerCase()
      const opacity = Number(params.get('opacity'))
      if (Number.isFinite(opacity) && opacity > 0) document.body.style.opacity = String(opacity)

      const root = document.getElementById('root')
      let dashboards = []

      function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
        })
      }

      function pick() {
        if (!dashboards.length) return null
        const match = dashboards.find(function (d) {
          const id = String(d.player.shortId || '').toLowerCase()
          const cfn = String(d.player.cfn || '').toLowerCase()
          const name = String(d.player.displayName || '').toLowerCase()
          return wanted && (id === wanted || cfn === wanted || name === wanted)
        })
        return match || dashboards[0]
      }

      function snapshotOf(dash) {
        if (!dash) return null
        if (preferred === 'lp') return dash.latestLp || dash.latestMr || null
        if (preferred === 'mr') return dash.latestMr || dash.latestLp || null
        return dash.latestMr || dash.latestLp || null
      }

      function render() {
        const dash = pick()
        const latest = snapshotOf(dash)
        if (!dash || !latest) {
          root.innerHTML = '<span class="muted" style="padding:8px">等待数据…</span>'
          return
        }
        const session = dash.session
        const delta = session
          ? latest.kind === 'LP' ? session.lpDelta : session.ratingDelta
          : null
        const deltaClass = delta == null ? 'delta' : delta > 0 ? 'delta up' : delta < 0 ? 'delta down' : 'delta'
        const deltaText = delta == null ? '' : (delta > 0 ? '+' : '') + delta
        const winRate = session && session.matches > 0
          ? Math.round((session.wins / session.matches) * 100) + '%'
          : '—'

        root.innerHTML =
          '<div class="card">' +
            '<div>' +
              '<div class="name">' + esc(dash.player.displayName || dash.player.cfn || '') + '</div>' +
              '<div class="rating">' +
                '<span class="kind">' + esc(latest.kind) + '</span>' +
                '<span class="value">' + Number(latest.value).toLocaleString() + '</span>' +
                '<span class="' + deltaClass + '">' + esc(deltaText) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="side">' +
              '<div><span class="label">会话</span><span>' +
                (session ? session.wins + 'W ' + session.losses + 'L' : '—') +
              '</span></div>' +
              '<div><span class="label">胜率</span><span>' + winRate + '</span></div>' +
            '</div>' +
          '</div>'
      }

      function merge(payload) {
        const dash = dashboards.find(function (d) { return d.player.shortId === payload.shortId })
        if (!dash) return
        if (payload.kind) {
          const point = { kind: payload.kind, value: payload.value, character: payload.character, observedAt: payload.observedAt }
          if (payload.kind === 'MR') dash.latestMr = point
          else dash.latestLp = point
        } else {
          dash.session = payload
        }
      }

      function connect() {
        const socket = new WebSocket('ws://127.0.0.1:${port}/ws')
        socket.addEventListener('message', function (event) {
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'snapshot') {
              dashboards = data.payload.dashboards || []
            } else if (data.type === 'rating:update' || data.type === 'session:update') {
              merge(data.payload)
            } else {
              return
            }
            render()
          } catch (error) {
            console.error(error)
          }
        })
        socket.addEventListener('close', function () {
          setTimeout(connect, 2000)
        })
      }

      connect()
      render()
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
