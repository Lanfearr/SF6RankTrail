import type { Match, ServerEvent, SyncStatus } from '../../shared/types'
import type { Repository } from '../db/repository'
import { Poller } from './poller'
import type { MatchSource } from './fetcher'

export interface SyncResult {
  shortId: string
  fetched: number
  inserted: number
}

export class SyncService {
  private poller: Poller | null = null
  private shortIds: string[] = []

  constructor(
    private readonly repo: Repository,
    private readonly source: MatchSource,
    private readonly emit: (event: ServerEvent) => void,
    private readonly onStatus: (status: SyncStatus) => void
  ) {}

  start(shortIds: string[], intervalMs = 20_000): void {
    this.shortIds = shortIds
    this.poller?.stop()
    this.poller = new Poller(
      async () => {
        await this.syncAll()
      },
      { intervalMs, onStatus: this.onStatus }
    )
    this.poller.start()
  }

  stop(): void {
    this.poller?.stop()
    this.poller = null
  }

  isRunning(): boolean {
    return this.poller !== null
  }

  getShortIds(): string[] {
    return [...this.shortIds]
  }

  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    for (const shortId of this.shortIds) {
      results.push(await this.sync(shortId))
    }
    return results
  }

  async sync(shortId: string): Promise<SyncResult> {
    const matches = await this.source.fetchMatches(shortId)
    const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt)
    let inserted = 0

    for (const match of ordered) {
      if (!this.repo.insertMatch(match)) continue
      inserted += 1
      this.emit({ type: 'match:new', payload: match })

      if (match.myMr !== null) {
        this.emitRating(shortId, match, 'MR', match.myMr)
      }
      if (match.myLp !== null) {
        this.emitRating(shortId, match, 'LP', match.myLp)
      }
    }

    this.repo.rebuildSessions(shortId)
    this.repo.markSynced(shortId)

    const session = this.repo.getLatestSession(shortId)
    if (session) {
      this.emit({ type: 'session:update', payload: session })
    }

    return { shortId, fetched: ordered.length, inserted }
  }

  private emitRating(
    shortId: string,
    match: Match,
    kind: 'MR' | 'LP',
    value: number
  ): void {
    const point = this.repo.insertRating({
      shortId,
      character: match.myChar,
      kind,
      value,
      source: 'battlelog',
      estimated: false,
      observedAt: match.playedAt
    })
    this.emit({ type: 'rating:update', payload: point })
  }
}
