import { useEffect, useMemo, useState } from 'react'
import type {
  AutoBackupStatus,
  ChartMode,
  UpdateCheckResult,
  UpdateProgress
} from '@shared/types'
import { PageHeader } from '../components/Page'
import { useAppStore } from '../store/useAppStore'

const fileSize = (bytes: number | null): string => {
  if (!bytes || bytes <= 0) return '未知大小'
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const updatePhaseText = (progress: UpdateProgress): string => {
  if (progress.phase === 'verifying') return '正在校验安装包…'
  if (progress.phase === 'ready') return '安装包已就绪'
  if (progress.phase === 'installing') return '正在启动安装向导…'
  if (progress.phase === 'error') return progress.message
  return `正在下载… ${progress.percent}%`
}

export function SettingsPage() {
  const players = useAppStore((state) => state.players)
  const activeShortId = useAppStore((state) => state.activeShortId)
  const sync = useAppStore((state) => state.sync)
  const setActive = useAppStore((state) => state.setActive)
  const addPlayer = useAppStore((state) => state.addPlayer)
  const removePlayer = useAppStore((state) => state.removePlayer)
  const login = useAppStore((state) => state.login)
  const start = useAppStore((state) => state.start)
  const stop = useAppStore((state) => state.stop)
  const refresh = useAppStore((state) => state.refresh)

  const [cfn, setCfn] = useState('')
  const [nickname, setNickname] = useState('')
  const [intervalMs, setIntervalMs] = useState('20000')
  const [chartMode, setChartMode] = useState<ChartMode>('mini')
  const [alwaysOnTop, setAlwaysOnTop] = useState(true)
  const [opacity, setOpacity] = useState(1)
  const [autoBackup, setAutoBackup] = useState(true)
  const [backupStatus, setBackupStatus] = useState<AutoBackupStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [version, setVersion] = useState('')
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null)

  const active = useMemo(
    () => players.find((player) => player.shortId === activeShortId) ?? null,
    [players, activeShortId]
  )
  const running = sync.state === 'syncing'

  const loadBackupStatus = async (): Promise<void> => {
    const status = await window.api.autoBackupStatus()
    setBackupStatus(status)
    setAutoBackup(status.enabled)
  }

  const applyAutoBackup = async (value: boolean): Promise<void> => {
    setAutoBackup(value)
    await window.api.setSetting('autoBackup', value ? '1' : '0')
    await loadBackupStatus()
    setMessage(value ? '自动备份已启用' : '自动备份已关闭')
  }

  const runBackup = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await window.api.runAutoBackup()
      await loadBackupStatus()
      setMessage(result.ok ? `已备份到 ${result.path}` : result.message ?? '备份失败')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void window.api.getSetting('syncIntervalMs').then((value) => {
      if (value) setIntervalMs(value)
    })
    void Promise.all([
      window.api.getSetting('chartMode'),
      window.api.getSetting('chartAlwaysOnTop')
    ]).then(([modeValue, topValue]) => {
      const nextMode = modeValue === 'pro' ? 'pro' : 'mini'
      setChartMode(nextMode)
      if (topValue === '1') setAlwaysOnTop(true)
      else if (topValue === '0') setAlwaysOnTop(false)
      else setAlwaysOnTop(nextMode === 'mini')
    })
    void window.api.getSetting('chartOpacity').then((value) => {
      const next = Number(value)
      if (Number.isFinite(next)) setOpacity(Math.min(1, Math.max(0.2, next)))
    })
    void loadBackupStatus()
    void window.api.getVersion().then(setVersion)
    void window.api.getUpdateState().then((state) => {
      if (state) setUpdateState(state)
    })
    return window.api.onUpdateProgress((progress) => setUpdateProgress(progress))
  }, [])

  const run = async (action: () => Promise<unknown>, label?: string): Promise<void> => {
    setBusy(true)
    if (label) setMessage(label)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const submitPlayer = async (): Promise<void> => {
    const value = cfn.trim()
    if (!value) return
    await addPlayer(value, nickname.trim() || undefined)
    setCfn('')
    setNickname('')
    setMessage('账号已添加')
  }

  const applyInterval = async (): Promise<void> => {
    const value = Number(intervalMs)
    if (!Number.isFinite(value)) return
    await window.api.setSetting('syncIntervalMs', String(Math.max(15_000, Math.min(120_000, value))))
    await refresh()
    setMessage('同步间隔已保存')
  }

  const applyChartMode = (mode: ChartMode): void => {
    setChartMode(mode)
    window.api.chartSetMode(mode)
    void window.api.getSetting('chartAlwaysOnTop').then((value) => {
      if (value !== '1' && value !== '0') setAlwaysOnTop(mode === 'mini')
    })
  }

  const applyAlwaysOnTop = (value: boolean): void => {
    setAlwaysOnTop(value)
    window.api.chartSetAlwaysOnTop(value)
  }

  const applyOpacity = (value: number): void => {
    setOpacity(value)
    window.api.chartSetOpacity(value)
  }

  const checkUpdates = async (): Promise<void> => {
    setCheckingUpdate(true)
    setUpdateProgress(null)
    try {
      const result = await window.api.checkForUpdates(true)
      setUpdateState(result)
    } finally {
      setCheckingUpdate(false)
    }
  }

  const installUpdate = async (): Promise<void> => {
    setInstallingUpdate(true)
    setUpdateProgress(null)
    try {
      const result = await window.api.downloadAndInstallUpdate()
      if (!result.ok && result.message) setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setInstallingUpdate(false)
    }
  }

  const overlayUrl = active
    ? `http://127.0.0.1:8765/overlay?player=${encodeURIComponent(
        active.cfn && active.cfn !== active.shortId ? active.cfn : active.shortId
      )}`
    : 'http://127.0.0.1:8765/overlay'

  return (
    <div className="page">
      <PageHeader title="设置" subtitle="账号、同步、图表窗口与 OBS 叠加层" />

      <div className="settings-grid">
        <section className="card">
          <div className="card-header">
            <h2>账号</h2>
            <span className="badge">{players.length} 个</span>
          </div>
          <div className="player-tags">
            {players.length === 0 && <span className="muted">暂无账号</span>}
            {players.map((player) => {
              const accountName =
                player.displayName ?? (player.cfn && player.cfn !== player.shortId ? player.cfn : null)
              const label = accountName ?? player.shortId
              return (
                <div
                  key={player.shortId}
                  className={player.shortId === activeShortId ? 'player-tag active' : 'player-tag'}
                  title={player.shortId}
                  onClick={() => setActive(player.shortId)}
                >
                  <button
                    type="button"
                    className="tag-remove"
                    title="删除账号"
                    aria-label={`删除 ${label}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation()
                      void run(() => removePlayer(player.shortId))
                    }}
                  >
                    ×
                  </button>
                  <span className="tag-name">{label}</span>
                  {accountName && <span className="tag-id">{player.shortId}</span>}
                </div>
              )
            })}
          </div>

          <div className="add-player">
            <input
              className="input"
              placeholder="CFN 或 short_id"
              value={cfn}
              onChange={(event) => setCfn(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitPlayer()
              }}
            />
            <div className="row">
              <input
                className="input"
                placeholder="昵称（可选）"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitPlayer()
                }}
              />
              <button className="btn" disabled={busy} onClick={() => void submitPlayer()}>
                添加
              </button>
            </div>
          </div>
          <button className="btn primary" disabled={busy} onClick={() => void run(login)}>
            登录 CAPCOM ID
          </button>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>同步</h2>
            <span className={running ? 'badge active' : 'badge'}>{sync.state}</span>
          </div>
          <p className="muted">{sync.message ?? '登录后自动开始同步'}</p>
          <div className="button-row">
            <button className="btn primary" disabled={busy || running} onClick={() => void run(start)}>
              开始同步
            </button>
            <button className="btn" disabled={busy || !running} onClick={() => void run(stop)}>
              停止同步
            </button>
          </div>
          <div className="row">
            <label className="label">间隔 (ms)</label>
            <input
              className="input compact"
              value={intervalMs}
              onChange={(event) => setIntervalMs(event.target.value)}
            />
            <button className="btn" onClick={() => void applyInterval()}>
              应用
            </button>
          </div>
          <span className="muted small">允许范围 15000–120000 ms</span>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>自动备份</h2>
            <span className={autoBackup ? 'badge active' : 'badge'}>
              {autoBackup ? '已启用' : '已关闭'}
            </span>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={autoBackup}
              onChange={(event) => void applyAutoBackup(event.target.checked)}
            />
            <span>每 24 小时自动备份数据库</span>
          </label>
          <p className="muted small">保留最近 14 份，保存在应用数据目录的 backups 文件夹。</p>
          <div className="button-row">
            <button className="btn" disabled={busy} onClick={() => void runBackup()}>
              立即备份
            </button>
          </div>
          {backupStatus && (
            <div className="kv-list compact">
              <div>
                <span>备份目录</span>
                <strong className="truncate" title={backupStatus.directory}>
                  {backupStatus.directory}
                </strong>
              </div>
              <div>
                <span>已有备份</span>
                <strong>{backupStatus.files} 份</strong>
              </div>
              <div>
                <span>上次备份</span>
                <strong>
                  {backupStatus.lastAt ? new Date(backupStatus.lastAt).toLocaleString() : '—'}
                </strong>
              </div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2>图表窗口</h2>
            <button className="btn" onClick={() => window.api.openChart()}>
              打开图表
            </button>
          </div>
          <div className="row">
            <label className="label">默认模式</label>
            <select
              className="select"
              value={chartMode}
              onChange={(event) => applyChartMode(event.target.value as ChartMode)}
            >
              <option value="mini">Mini</option>
              <option value="pro">Pro（最近 20 场）</option>
            </select>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={alwaysOnTop}
              onChange={(event) => applyAlwaysOnTop(event.target.checked)}
            />
            <span>图表窗口置顶</span>
          </label>
          <div className="row">
            <label className="label">不透明度</label>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(event) => applyOpacity(Number(event.target.value))}
            />
            <span className="muted">{Math.round(opacity * 100)}%</span>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>OBS 叠加层</h2>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard.writeText(overlayUrl)
                setMessage('叠加层地址已复制')
              }}
            >
              复制地址
            </button>
          </div>
          <code className="overlay-url">{overlayUrl}</code>
          <p className="muted small">
            将地址添加为 OBS 浏览器源。使用 player 参数锁定当前账号；也可以省略参数自动跟随主账号。
          </p>
        </section>

        <section className="card">
          <div className="card-header">
            <h2>软件更新</h2>
            <span className="badge">当前 v{version || '…'}</span>
          </div>
          <p className="muted small">
            从 GitHub Releases 检查最新版本，发现更新后可下载并启动安装向导。
          </p>
          <div className="button-row">
            <button
              className="btn"
              disabled={checkingUpdate || installingUpdate}
              onClick={() => void checkUpdates()}
            >
              {checkingUpdate ? '检查中…' : '检查更新'}
            </button>
            {updateState?.available && (
              <button
                className="btn primary"
                disabled={installingUpdate}
                onClick={() => void installUpdate()}
              >
                {installingUpdate ? '处理中…' : '下载并安装'}
              </button>
            )}
          </div>

          {updateState?.error && <p className="update-error">{updateState.error}</p>}

          {!updateState?.error && updateState?.available && updateState.release && (
            <>
              <div className="kv-list compact">
                <div>
                  <span>最新版本</span>
                  <strong>v{updateState.release.version}</strong>
                </div>
                <div>
                  <span>安装包</span>
                  <strong className="truncate" title={updateState.release.assetName ?? ''}>
                    {updateState.release.assetName ?? '未提供'}
                  </strong>
                </div>
                <div>
                  <span>大小</span>
                  <strong>{fileSize(updateState.release.assetSize)}</strong>
                </div>
              </div>
              {updateState.release.notes && (
                <details className="update-notes">
                  <summary>更新说明</summary>
                  <pre>{updateState.release.notes}</pre>
                </details>
              )}
            </>
          )}

          {!updateState?.error &&
            updateState &&
            !updateState.available &&
            updateState.latestVersion && (
              <p className="muted small">已是最新版本（v{updateState.latestVersion}）。</p>
            )}

          {!updateState && <p className="muted small">尚未检查更新。</p>}

          {updateProgress && updateProgress.phase !== 'error' && (
            <div className="update-progress">
              <div className="update-progress-bar">
                <span
                  style={{ width: `${Math.min(100, Math.max(0, updateProgress.percent))}%` }}
                />
              </div>
              <span className="muted small">{updatePhaseText(updateProgress)}</span>
            </div>
          )}

          {updateProgress?.phase === 'error' && (
            <p className="update-error">{updateProgress.message}</p>
          )}
        </section>
      </div>

      {message && <div className="toast">{message}</div>}
    </div>
  )
}
