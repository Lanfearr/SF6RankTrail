import { useState } from 'react'
import type { ExportResult } from '@shared/types'
import { PageHeader } from '../components/Page'

interface Props {
  shortId: string | null
}

type ExportKind = 'csv' | 'json' | 'db'

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
    kind: 'db',
    title: '数据库备份',
    description: '复制当前 SQLite 数据库，包含所有账号的完整本地数据。',
    button: '备份数据库'
  }
]

export function ExportPage({ shortId }: Props) {
  const [busy, setBusy] = useState<ExportKind | null>(null)
  const [results, setResults] = useState<Partial<Record<ExportKind, ExportResult>>>({})

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
            : await window.api.backupDatabase()
      setResults((current) => ({ ...current, [kind]: result }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="数据导出 / 备份"
        subtitle={shortId ? `当前账号 ${shortId}` : '请先选择账号'}
      />
      <div className="export-grid">
        {TASKS.map((task) => {
          const result = results[task.kind]
          const disabled = busy !== null || (task.kind !== 'db' && !shortId)
          return (
            <section className="card export-card" key={task.kind}>
              <div>
                <h2>{task.title}</h2>
                <p className="muted">{task.description}</p>
              </div>
              <button className="btn primary" disabled={disabled} onClick={() => void run(task.kind)}>
                {busy === task.kind ? '正在导出…' : task.button}
              </button>
              {result && (
                <div className={result.ok ? 'export-result ok' : 'export-result'}>
                  <span>{result.ok ? '已保存到：' : result.message ?? '导出失败'}</span>
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
