export interface RateLimitOptions {
  minIntervalMs: number
  maxBackoffMs: number
}

export class RateLimiter {
  private lastAt = 0
  private backoffMs = 0

  constructor(private readonly options: RateLimitOptions) {}

  async acquire(): Promise<void> {
    const now = Date.now()
    const wait = Math.max(0, this.lastAt + this.options.minIntervalMs - now)
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    this.lastAt = Date.now()
  }

  success(): void {
    this.backoffMs = 0
  }

  failure(): number {
    this.backoffMs = this.backoffMs === 0 ? 5_000 : Math.min(this.backoffMs * 2, this.options.maxBackoffMs)
    return this.backoffMs
  }

  get currentBackoff(): number {
    return this.backoffMs
  }
}
