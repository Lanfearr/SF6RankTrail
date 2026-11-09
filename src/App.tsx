import { useEffect, useState } from 'react'
import type { Match } from '@shared/types'
import { useRealtime } from './lib/useRealtime'
import { CharactersPage } from './pages/CharactersPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { ExportPage } from './pages/ExportPage'
import { MatchDetailPage } from './pages/MatchDetailPage'
import { MatchesPage } from './pages/MatchesPage'
import { OpponentsPage } from './pages/OpponentsPage'
import { OverviewPage } from './pages/OverviewPage'
import { ProgressPage } from './pages/ProgressPage'
import { SeasonPage } from './pages/SeasonPage'
import { SessionsPage } from './pages/SessionsPage'
import { SettingsPage } from './pages/SettingsPage'
import { useAppStore } from './store/useAppStore'

type Page =
  | 'overview'
  | 'sessions'
  | 'progress'
  | 'matches'
  | 'detail'
  | 'characters'
  | 'opponents'
  | 'season'
  | 'export'
  | 'diagnostics'
  | 'settings'

const NAV: Array<{ page: Page; label: string }> = [
  { page: 'overview', label: '概览' },
  { page: 'sessions', label: '会话历史' },
  { page: 'progress', label: '目标与趋势' },
  { page: 'matches', label: '对战记录' },
  { page: 'detail', label: '对战详情' },
  { page: 'characters', label: '角色统计' },
  { page: 'opponents', label: '对手分析' },
  { page: 'season', label: '赛季报告' },
  { page: 'export', label: '数据导出 / 备份' },
  { page: 'diagnostics', label: '数据同步' },
  { page: 'settings', label: '设置' }
]

export default function App() {
  useRealtime()

  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const lastEvent = useAppStore((state) => state.lastEvent)
  const warning = useAppStore((state) => state.warning)
  const setActive = useAppStore((state) => state.setActive)
  const clearWarning = useAppStore((state) => state.clearWarning)

  const [page, setPage] = useState<Page>('overview')
  const [selectedMatch, setSelectedMatch] = useState<Match | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.getVersion().then(setVersion)
  }, [])

  const openMatch = (match: Match): void => {
    setSelectedMatch(match)
    setPage('detail')
  }

  const renderPage = () => {
    switch (page) {
      case 'overview':
        return <OverviewPage />
      case 'sessions':
        return <SessionsPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'progress':
        return <ProgressPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'matches':
        return <MatchesPage shortId={activeShortId} onSelectMatch={openMatch} />
      case 'detail':
        return <MatchDetailPage shortId={activeShortId} selectedMatch={selectedMatch} />
      case 'characters':
        return <CharactersPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'opponents':
        return <OpponentsPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'season':
        return <SeasonPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'export':
        return <ExportPage shortId={activeShortId} />
      case 'diagnostics':
        return <DiagnosticsPage shortId={activeShortId} lastEvent={lastEvent} />
      case 'settings':
        return <SettingsPage />
    }
  }

  return (
    <div className="main-shell">
      <header className="main-header">
        <div className="main-brand">
          <strong>SF6 Scorer</strong>
          <span className="muted">Street Fighter 6 战绩面板</span>
        </div>
        <div className="main-header-actions">
          <label className="account-select">
            <span>账号</span>
            <select
              value={activeShortId ?? ''}
              onChange={(event) => setActive(event.target.value)}
              disabled={players.length === 0}
            >
              {players.length === 0 && <option value="">未添加账号</option>}
              {players.map((player) => (
                <option key={player.shortId} value={player.shortId}>
                  {player.displayName ?? player.cfn ?? player.shortId}
                </option>
              ))}
            </select>
          </label>
          <span className={sync.state === 'error' ? 'sync-pill error' : 'sync-pill'}>
            <span className="sync-dot" />
            {sync.state}
          </span>
          <button className="btn primary" onClick={() => window.api.openChart()}>
            打开图表
          </button>
        </div>
      </header>

      {warning && (
        <div className="banner">
          <span>{warning}</span>
          <button className="btn small" onClick={clearWarning}>
            忽略
          </button>
        </div>
      )}

      <div className="main-body">
        <nav className="main-nav">
          {NAV.map((item) => (
            <button
              key={item.page}
              className={page === item.page ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(item.page)}
            >
              {item.label}
            </button>
          ))}
          <div className="nav-footer">
            <span className="muted small">最近事件</span>
            <span>{lastEvent}</span>
            {version && <span className="app-version">v{version}</span>}
          </div>
        </nav>
        <main className="main-content">{renderPage()}</main>
      </div>
    </div>
  )
}
