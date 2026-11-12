const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 15_000
const JITTER_MS = 400

export const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUSES.has(status) || (status >= 500 && status <= 599)

export const parseRetryAfter = (value: string | null, now = Date.now()): number | null => {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000))
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(0, date - now)
}

export const retryDelayMs = (
  attempt: number,
  retryAfterMs: number | null = null,
  random: () => number = Math.random
): number => {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
  const delay = base + Math.round(random() * JITTER_MS)
  if (retryAfterMs === null) return delay
  return Math.min(MAX_DELAY_MS, Math.max(delay, retryAfterMs))
}
