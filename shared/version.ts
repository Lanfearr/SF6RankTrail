export function parseVersion(raw: string): number[] {
  const cleaned = raw.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? ''
  const parts = cleaned
    .split('.')
    .map((part) => {
      const match = /^\d+/.exec(part.trim())
      return match ? Number(match[0]) : 0
    })
    .filter((value) => Number.isFinite(value))
  while (parts.length > 0 && parts[parts.length - 1] === 0) parts.pop()
  return parts.length > 0 ? parts : [0]
}

/** Returns 1 when a > b, -1 when a < b, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}
