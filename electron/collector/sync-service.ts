import type { Match, RatingPoint, ServerEvent, SyncStatus } from '../../shared/types'
import type { Repository } from '../db/repository'
import { Poller } from './poller'
import type { MatchSource } from './fetcher'

export interface SyncResult {
  shortId: string
  fetched: number
  inserted: number
}

const BULK_THRESHOLD = 10
const MAX_INCREMENTAL_PAGES = 50
const PAGE_DELAY_MS = 400

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class SyncService {
  private poller: Poller | null = null
  private shortIds: string[] = []
  private readonly zeroStreak = new Map<string, number>()
  private readonly failed = new Set<string>()
  private readonly currentFailed = new Set<string>()

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
      try {
        results.push(await this.sync(shortId))
        this.failed.delete(shortId)
      } catch (error) {
        if (this.failed.has(shortId)) continue
        this.failed.add(shortId)
        const message = error instanceof Error ? error.message : String(error)
        this.emit({
          type: 'sync:warning',
          payload: { shortId, message: `同步失败：${message}` }
        })
      }
    }
    return results
  }

  async sync(shortId: string): Promise<SyncResult> {
    const backfillKey = `backfill:${shortId}`
    const needsBackfill =
      Boolean(this.source.fetchAllMatches) && this.repo.getSetting(backfillKey) !== '1'

    let recent: { matches: Match[]; fetched: number }
    if (needsBackfill) {
      const all = await this.source.fetchAllMatches!(shortId)
      recent = { matches: all, fetched: all.length }
    } else {
      recent = await this.fetchRecent(shortId)
    }

    const playerName = this.source.getPlayerName?.(shortId)
    if (playerName) this.repo.setDisplayNameIfEmpty(shortId, playerName)

    const inserted = this.storeMatches(shortId, recent.matches)
    if (needsBackfill) this.repo.setSetting(backfillKey, '1')

    let currentRatings: RatingPoint[] = []
    if (this.source.fetchCurrentRatings) {
      try {
        currentRatings = this.repo.recordCurrentRatings(
          shortId,
          await this.source.fetchCurrentRatings(shortId)
        )
        this.currentFailed.delete(shortId)
      } catch (error) {
        if (!this.currentFailed.has(shortId)) {
          this.currentFailed.add(shortId)
          const message = error instanceof Error ? error.message : String(error)
          this.emit({
            type: 'sync:warning',
            payload: { shortId, message: `当前分数获取失败：${message}` }
          })
        }
      }
    }

    this.repo.rebuildSessions(shortId)
    this.repo.markSynced(shortId)

    for (const point of currentRatings) {
      this.emit({ type: 'rating:update', payload: point })
    }

    const session = this.repo.getActiveSession(shortId)
    if (session) {
      this.emit({ type: 'session:update', payload: session })
    }

    this.checkDataHealth(shortId, recent.fetched)
    return { shortId, fetched: recent.fetched, inserted }
  }

  private async fetchRecent(shortId: string): Promise<{ matches: Match[]; fetched: number }> {
    const found = new Map<string, Match>()
    let previousSignature = ''
    let fetched = 0

    for (let page = 1; page <= MAX_INCREMENTAL_PAGES; page += 1) {
      const matches = await this.source.fetchMatches(shortId, page)
      const signature = matches
        .map((match) => match.replayId)
        .sort()
        .join('|')
      if (page > 1 && signature === previousSignature) break
      previousSignature = signature
      if (matches.length === 0) break

      fetched += matches.length
      let pageHasExisting = false
      for (const match of matches) {
        if (this.repo.hasMatch(match.replayId)) {
          pageHasExisting = true
          continue
        }
        found.set(match.replayId, match)
      }
      if (pageHasExisting) break
      if (page < MAX_INCREMENTAL_PAGES) await sleep(PAGE_DELAY_MS)
    }

    return { matches: [...found.values()], fetched }
  }

  private storeMatches(shortId: string, matches: Match[]): number {
    const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt)
    const created: Array<{ match: Match; mr: RatingPoint | null; lp: RatingPoint | null }> = []

    for (const match of ordered) {
      if (!this.repo.insertMatch(match)) continue
      const mr = match.myMr !== null ? this.insertRating(shortId, match, 'MR', match.myMr) : null
      const lp = match.myLp !== null ? this.insertRating(shortId, match, 'LP', match.myLp) : null
      created.push({ match, mr, lp })
    }

    if (created.length > BULK_THRESHOLD) {
      const latest = created[created.length - 1]
      if (latest) {
        this.emit({ type: 'match:new', payload: latest.match })
        if (latest.mr) this.emit({ type: 'rating:update', payload: latest.mr })
        if (latest.lp) this.emit({ type: 'rating:update', payload: latest.lp })
      }
    } else {
      for (const entry of created) {
        this.emit({ type: 'match:new', payload: entry.match })
        if (entry.mr) this.emit({ type: 'rating:update', payload: entry.mr })
        if (entry.lp) this.emit({ type: 'rating:update', payload: entry.lp })
      }
    }

    return created.length
  }

  private insertRating(
    shortId: string,
    match: Match,
    kind: 'MR' | 'LP',
    value: number
  ): RatingPoint {
    return this.repo.insertRating({
      shortId,
      character: match.myChar,
      kind,
      value,
      source: 'battlelog',
      estimated: false,
      observedAt: match.playedAt
    })
  }

  private checkDataHealth(shortId: string, fetched: number): void {
    if (fetched > 0) {
      this.zeroStreak.delete(shortId)
      return
    }

    const streak = (this.zeroStreak.get(shortId) ?? 0) + 1
    this.zeroStreak.set(shortId, streak)

    if (streak >= 3 && this.repo.countMatches(shortId) > 0) {
      this.emit({
        type: 'sync:warning',
        payload: {
          shortId,
          message: '连续 3 次未获取到对局，数据源可能改版或页面为空'
        }
      })
      this.zeroStreak.set(shortId, 0)
    }
  }
}
