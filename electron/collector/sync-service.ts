import type { CurrentRating, Match, RatingPoint, ServerEvent, SyncStatus } from '../../shared/types'
import type { Repository } from '../db/repository'
import { Poller } from './poller'
import type { MatchSource } from './fetcher'

export interface SyncResult {
  shortId: string
  fetched: number
  inserted: number
  fullScan?: boolean
  fullScanError?: string
  oldestFetchedAt?: number
  newestFetchedAt?: number
}

const BULK_THRESHOLD = 10
const MAX_INCREMENTAL_PAGES = 50
const PAGE_DELAY_MS = 400
const FULL_SCAN_INTERVAL_MS = 60 * 60 * 1000
const FULL_SCAN_RETRY_MS = 5 * 60 * 1000

type MatchRange = {
  oldestFetchedAt?: number
  newestFetchedAt?: number
}

type RecentMatches = MatchRange & {
  matches: Match[]
  fetched: number
}

type StoredMatch = {
  match: Match
  mr: RatingPoint | null
  lp: RatingPoint | null
}

type StoreResult = {
  inserted: number
  created: StoredMatch[]
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const matchRange = (matches: Match[]): MatchRange => {
  let oldestFetchedAt: number | undefined
  let newestFetchedAt: number | undefined
  for (const match of matches) {
    if (!Number.isFinite(match.playedAt)) continue
    if (oldestFetchedAt === undefined || match.playedAt < oldestFetchedAt) {
      oldestFetchedAt = match.playedAt
    }
    if (newestFetchedAt === undefined || match.playedAt > newestFetchedAt) {
      newestFetchedAt = match.playedAt
    }
  }
  return { oldestFetchedAt, newestFetchedAt }
}

export class SyncService {
  private poller: Poller | null = null
  private shortIds: string[] = []
  private readonly zeroStreak = new Map<string, number>()
  private readonly failed = new Set<string>()
  private readonly currentFailed = new Set<string>()
  private readonly fullScanRetryAt = new Map<string, number>()
  private readonly syncQueues = new Map<string, Promise<SyncResult>>()
  private stopping = false

  constructor(
    private readonly repo: Repository,
    private readonly source: MatchSource,
    private readonly emit: (event: ServerEvent) => void,
    private readonly onStatus: (status: SyncStatus) => void
  ) {}

  start(shortIds: string[], intervalMs = 20_000): void {
    this.shortIds = shortIds
    this.stopping = false
    this.poller?.stop()
    this.poller = new Poller(
      async () => {
        await this.syncAll()
      },
      { intervalMs, onStatus: this.onStatus }
    )
    this.poller.start()
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.poller?.stop()
    this.poller = null
    await Promise.allSettled([...this.syncQueues.values()])
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
      if (this.stopping) break
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

  async sync(shortId: string, forceFullScan = false): Promise<SyncResult> {
    const previous = this.syncQueues.get(shortId) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(() => this.runSync(shortId, forceFullScan))
    this.syncQueues.set(shortId, task)
    try {
      return await task
    } finally {
      if (this.syncQueues.get(shortId) === task) this.syncQueues.delete(shortId)
    }
  }

  async rescan(shortId: string): Promise<SyncResult> {
    this.fullScanRetryAt.delete(shortId)
    return this.sync(shortId, true)
  }

  private async runSync(shortId: string, forceFullScan: boolean): Promise<SyncResult> {
    const fullScanKey = `lastFullScanAt:${shortId}`
    const canFullScan = Boolean(this.source.fetchAllMatches)
    const needsFullScan = canFullScan && (forceFullScan || this.shouldFullScan(shortId))

    let recent: RecentMatches
    let fullScanCompleted = false
    let fullScanError: string | undefined
    if (needsFullScan) {
      try {
        const all = await this.source.fetchAllMatches!(shortId)
        if (all.length === 0 && this.repo.countMatches(shortId) > 0) {
          throw new Error('完整扫描未返回对局')
        }
        recent = { matches: all, fetched: all.length, ...matchRange(all) }
        fullScanCompleted = true
      } catch (error) {
        fullScanError = error instanceof Error ? error.message : String(error)
        this.fullScanRetryAt.set(shortId, Date.now() + FULL_SCAN_RETRY_MS)
        recent = await this.fetchRecent(shortId)
      }
    } else {
      recent = await this.fetchRecent(shortId)
    }

    const playerName = this.source.getPlayerName?.(shortId)
    if (playerName) this.repo.setDisplayNameIfEmpty(shortId, playerName)

    let currentRatingsInput: CurrentRating[] | null = null
    if (this.source.fetchCurrentRatings) {
      try {
        currentRatingsInput = await this.source.fetchCurrentRatings(shortId)
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

    const stored = this.repo.transaction(() => {
      const matches = this.storeMatches(shortId, recent.matches)
      const currentRatings = currentRatingsInput
        ? this.repo.recordCurrentRatings(shortId, currentRatingsInput)
        : []
      return { ...matches, currentRatings }
    })
    if (currentRatingsInput) this.currentFailed.delete(shortId)

    if (fullScanCompleted) {
      this.repo.setSetting(fullScanKey, String(Date.now()))
      this.repo.setSetting(`backfill:${shortId}`, '1')
      this.fullScanRetryAt.delete(shortId)
    }

    this.repo.rebuildSessions(shortId)
    this.repo.markSynced(shortId)

    this.emitStoredMatches(stored.created)
    for (const point of stored.currentRatings) {
      this.emit({ type: 'rating:update', payload: point })
    }

    const session = this.repo.getActiveSession(shortId)
    if (session) {
      this.emit({ type: 'session:update', payload: session })
    }

    this.checkDataHealth(shortId, recent.fetched)
    return {
      shortId,
      fetched: recent.fetched,
      inserted: stored.inserted,
      fullScan: fullScanCompleted,
      fullScanError,
      oldestFetchedAt: recent.oldestFetchedAt,
      newestFetchedAt: recent.newestFetchedAt
    }
  }

  private shouldFullScan(shortId: string): boolean {
    const retryAt = this.fullScanRetryAt.get(shortId)
    if (retryAt !== undefined && Date.now() < retryAt) return false

    const raw = this.repo.getSetting(`lastFullScanAt:${shortId}`)
    if (raw === null) return true
    const lastScan = Number(raw)
    return !Number.isFinite(lastScan) || Date.now() - lastScan >= FULL_SCAN_INTERVAL_MS
  }

  private async fetchRecent(shortId: string): Promise<RecentMatches> {
    const found = new Map<string, Match>()
    const scanned = new Map<string, Match>()
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
      let pageNew = 0
      for (const match of matches) {
        scanned.set(match.replayId, match)
        if (this.repo.hasMatch(shortId, match.replayId)) {
          this.repo.updateOpponentName(shortId, match.replayId, match.opponentName)
          continue
        }
        found.set(match.replayId, match)
        pageNew += 1
      }
      if (pageNew === 0) break
      if (page < MAX_INCREMENTAL_PAGES) await sleep(PAGE_DELAY_MS)
    }

    return { matches: [...found.values()], fetched, ...matchRange([...scanned.values()]) }
  }

  private storeMatches(shortId: string, matches: Match[]): StoreResult {
    const ordered = [...matches].sort((a, b) => a.playedAt - b.playedAt)
    const created: StoredMatch[] = []

    for (const match of ordered) {
      if (!this.repo.insertMatch(match)) {
        this.repo.updateOpponentName(shortId, match.replayId, match.opponentName)
        continue
      }
      const mr = match.myMr !== null ? this.insertRating(shortId, match, 'MR', match.myMr) : null
      const lp = match.myLp !== null ? this.insertRating(shortId, match, 'LP', match.myLp) : null
      created.push({ match, mr, lp })
    }

    return { inserted: created.length, created }
  }

  private emitStoredMatches(created: StoredMatch[]): void {
    if (created.length > BULK_THRESHOLD) {
      const latest = created[created.length - 1]
      if (latest) {
        this.emit({ type: 'match:new', payload: latest.match })
        if (latest.mr) this.emit({ type: 'rating:update', payload: latest.mr })
        if (latest.lp) this.emit({ type: 'rating:update', payload: latest.lp })
      }
      return
    }

    for (const entry of created) {
      this.emit({ type: 'match:new', payload: entry.match })
      if (entry.mr) this.emit({ type: 'rating:update', payload: entry.mr })
      if (entry.lp) this.emit({ type: 'rating:update', payload: entry.lp })
    }
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
