import { useState } from 'react'
import type { ExportResult, ImportResult } from '@shared/types'
import { PageHeader } from '../components/Page'
import { useAppStore } from '../store/useAppStore'

interface Props {
  shortId: string | null
}

type ExportKind = 'csv' | 'json' | 'import' | 'db'

const TASKS: Array<{
  kind: ExportKind
  title: string
  description: string
  button: string
}> = [
  {
    kind: 'csv',
    title: '对战记录 CSV',
    description: '导出当前账号的全部对局，适合在 Excel 中分析或长期归档。',
    button: '导出 CSV'
  },
  {
    kind: 'json',
    title: '完整数据 JSON',
    description: '导出账号、对局、分数点和会话数据，适合迁移或二次处理。',
    button: '导出 JSON'
  },
  {
    kind: 'import',
    title: '恢复 JSON 备份',
    description: '从本应用导出的 JSON 文件恢复账号数据；重复对局会自动跳过，并重建会话历史。',
    button: '选择 JSON 恢复'
  },
  {
    kind: 'db',
    title: '数据库备份',
    description: '复制当前 SQLite 数据库，包含所有账号的完整本地数据。',
    button: '备份数据库'
  }
]

export function ExportPage({ shortId }: Props) {
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [results, setResults] = useState<Partial<Record<ExportKind, ExportResult | ImportResult>>>({})
  const refresh = useAppStore((state) => state.refresh)
  const setLastEvent = useAppStore((state) => state.setLastEvent)

  const run = async (kind: ExportKind): Promise<void> => {
    setBusy(kind)
    try {
      const result =
        kind === 'csv'
          ? shortId
            ? await window.api.exportMatchesCsv(shortId)
            : { ok: false, message: '尚未选择账号' }
          : kind === 'json'
            ? shortId
              ? await window.api.exportDataJson(shortId)
              : { ok: false, message: '尚未选择账号' }
            : kind === 'import'
              ? await window.api.importDataJson()
              : await window.api.backupDatabase()
      setResults((current) => ({ ...current, [kind]: result }))
      if (kind === 'import' && result.ok) {
        await refresh()
        setLastEvent('JSON 备份已恢复')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="数据导出 / 备份与恢复"
        subtitle={shortId ? `当前账号 ${shortId}` : '请先选择账号'}
      />
      <div className="export-grid">
        {TASKS.map((task) => {
          const result = results[task.kind]
          const summary = result && 'summary' in result ? result.summary : undefined
          const disabled =
            busy !== null ||
            (task.kind !== 'db' && task.kind !== 'import' && !shortId)
          return (
            <section className="card export-card" key={task.kind}>
              <div>
                <h2>{task.title}</h2>
                <p className="muted">{task.description}</p>
              </div>
              <button className="btn primary" disabled={disabled} onClick={() => void run(task.kind)}>
                {busy === task.kind
                  ? task.kind === 'import'
                    ? '正在导入…'
                    : '正在导出…'
                  : task.button}
              </button>
              {result && (
                <div className={result.ok ? 'export-result ok' : 'export-result'}>
                  <span>
                    {result.ok
                      ? task.kind === 'import'
                        ? '已恢复备份：'
                        : '已保存到：'
                      : result.message ?? '操作失败'}
                  </span>
                  {summary && (
                    <span className="muted">
                      新增 {summary.matches} 场对局、{summary.ratings} 个分数点
                      {summary.skippedMatches > 0 || summary.skippedRatings > 0
                        ? `，跳过 ${summary.skippedMatches} 场重复对局、${summary.skippedRatings} 个重复分数点`
                        : ''}
                    </span>
                  )}
                  {result.path && (
                    <>
                      <code>{result.path}</code>
                      <button
                        className="btn small"
                        onClick={() => void navigator.clipboard.writeText(result.path ?? '')}
                      >
                        复制路径
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
