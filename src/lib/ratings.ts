import type { RatingPoint } from '@shared/types'

export function buildRatingDeltas(points: RatingPoint[]): Map<number, number> {
  const groups = new Map<string, RatingPoint[]>()
  for (const point of points) {
    const key = point.character ?? ''
    const group = groups.get(key)
    if (group) group.push(point)
    else groups.set(key, [point])
  }

  const deltas = new Map<number, number>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.observedAt - b.observedAt || a.id - b.id)
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1]
      const next = group[index]
      if (!previous || !next || next.observedAt <= previous.observedAt) continue
      deltas.set(previous.observedAt, next.value - previous.value)
    }
  }
  return deltas
}
