import { useEffect, useState } from 'react'
import type { Diagnostics } from '@shared/types'
import { EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/Page'
import { useAppStore } from '../store/useAppStore'

interface Props {
  shortId: string | null
  lastEvent: string
}

const timeText = (value: number | null): string =>
  value ? new Date(value).toLocaleString() : '—'

export function DiagnosticsPage({ shortId, lastEvent }: Props) {
  const sync = useAppStore((state) => state.sync)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)
  const [data, setData] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!shortId) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const load = (): void => {
      void window.api
        .diagnostics(shortId)
        .then((value) => {
          if (!cancelled) setData(value)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }
    load()
    const timer = window.setInterval(load, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [shortId, lastEvent, tick])

  const run = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await action()
      setTick((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const running = sync.state === 'syncing'

  return (
    <div className="page">
      <PageHeader
        title="数据同步"
        subtitle="检查登录、同步状态与本地数据完整性"
        actions={
          <>
            <button className="btn" disabled={busy} onClick={() => setTick((value) => value + 1)}>
              刷新诊断
            </button>
            <button className="btn primary" disabled={busy || running} onClick={() => void run(start)}>
              开始同步
            </button>
            <button className="btn" disabled={busy || !running} onClick={() => void run(stop)}>
              停止同步
            </button>
          </>
        }
      />

      {!shortId ? (
        <EmptyState
          title="尚未选择账号"
          detail="登录后会显示同步诊断信息。"
          action={
            <button className="btn primary" disabled={busy} onClick={() => void run(login)}>
              登录 CAPCOM ID
            </button>
          }
        />
      ) : loading && !data ? (
        <LoadingBlock />
      ) : !data ? (
        <EmptyState title="暂无诊断数据" />
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              label="登录状态"
              value={data.loggedIn ? '已登录' : '未登录'}
              tone={data.loggedIn ? 'up' : 'down'}
              detail={data.shortId}
            />
            <StatCard label="对局总数" value={data.counts.matches} detail={`${data.counts.ratingPoints} 个分数点`} />
            <StatCard label="会话总数" value={data.counts.sessions} detail={data.sessionStartedAt ? `当前会话 ${timeText(data.sessionStartedAt)}` : '当前无会话'} />
            <StatCard label="最近同步" value={timeText(data.lastSynced)} detail={`最新对局 ${timeText(data.latestMatchAt)}`} />
          </div>

          <div className="two-column">
            <section className="card">
              <div className="card-header">
                <h2>当前状态</h2>
                <span className={running ? 'badge active' : 'badge'}>{sync.state}</span>
              </div>
              <p className="muted">{sync.message ?? '运行正常'}</p>
              <div className="kv-list">
                <div>
                  <span>追踪账号</span>
                  <strong>{data.counts.players}</strong>
                </div>
                <div>
                  <span>当前账号</span>
                  <strong>{data.shortId}</strong>
                </div>
                <div>
                  <span>开始同步</span>
                  <strong>{running ? '是' : '否'}</strong>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2>最近状态</h2>
                <span className="muted">最多 20 条</span>
              </div>
              {data.recentStatuses.length === 0 ? (
                <EmptyState title="暂无记录" />
              ) : (
                <ul className="status-list">
                  {data.recentStatuses.map((status, index) => (
                    <li key={`${status.at}-${index}`}>
                      <span className={`badge ${status.state === 'error' ? 'error' : status.state === 'syncing' ? 'active' : ''}`}>
                        {status.state}
                      </span>
                      <span className="muted">{new Date(status.at).toLocaleTimeString()}</span>
                      <span>{status.message ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
