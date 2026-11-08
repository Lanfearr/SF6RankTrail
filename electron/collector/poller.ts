import type { SyncStatus } from '../../shared/types'
import { RateLimiter } from './rate-limiter'

export interface PollerOptions {
  intervalMs: number
  onStatus: (status: SyncStatus) => void
}

export type SyncTask = () => Promise<void>

export class Poller {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private readonly limiter = new RateLimiter({
    minIntervalMs: 15_000,
    maxBackoffMs: 300_000
  })

  constructor(
    private readonly task: SyncTask,
    private readonly options: PollerOptions
  ) {}

  start(): void {
    if (this.timer) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    this.options.onStatus({ state: 'syncing', at: Date.now() })
    try {
      await this.limiter.acquire()
      await this.task()
      this.limiter.success()
      this.options.onStatus({ state: 'idle', at: Date.now() })
    } catch (error) {
      const wait = this.limiter.failure()
      this.options.onStatus({
        state: 'error',
        at: Date.now(),
        message: `${error instanceof Error ? error.message : String(error)} (retry in ${wait}ms)`
      })
    } finally {
      this.running = false
    }
  }
}
