import { OpponentInfoCard } from '../components/OpponentInfoCard'
import { EmptyState, PageHeader } from '../components/Page'

interface Props {
  shortId: string | null
  opponent: { id: string; name: string | null } | null
  onBack: () => void
}

export function OpponentDetailPage({ shortId, opponent, onBack }: Props) {
  return (
    <div className="page">
      <PageHeader
        title="对手详情"
        subtitle={opponent ? `玩家 ID：${opponent.id}` : '选择对手查看详情'}
        actions={
          <button type="button" className="btn" onClick={onBack}>
            返回对手分析
          </button>
        }
      />
      {!shortId ? (
        <EmptyState title="尚未选择账号" detail="请先登录或在设置中添加账号。" />
      ) : !opponent ? (
        <EmptyState
          title="尚未选择对手"
          detail="请返回对手分析并从宿敌列表中选择一名玩家。"
          action={
            <button type="button" className="btn" onClick={onBack}>
              返回对手分析
            </button>
          }
        />
      ) : (
        <div className="detail-grid">
          <OpponentInfoCard
            shortId={shortId}
            opponentId={opponent.id}
            opponentName={opponent.name}
          />
        </div>
      )}
    </div>
  )
}
