import type { ReactNode } from 'react'

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  detail,
  tone
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'up' | 'down' | 'muted'
}) {
  return (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={tone ? `stat-value ${tone}` : 'stat-value'}>{value}</span>
      {detail && <span className="stat-detail">{detail}</span>}
    </div>
  )
}

export function EmptyState({
  title,
  detail,
  action
}: {
  title: string
  detail?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {detail && <p className="muted">{detail}</p>}
      {action}
    </div>
  )
}

export function LoadingBlock({ label = '加载中…' }: { label?: string }) {
  return <div className="loading-block">{label}</div>
}
