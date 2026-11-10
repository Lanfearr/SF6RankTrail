import type { Match, RatingPoint } from '@shared/types'

export const seriesKey = (character: string | null, observedAt: number): string =>
  `${character ?? ''}\u0000${observedAt}`

export function buildChartPoints(points: RatingPoint[], matches: Match[]): RatingPoint[] {
  const matchesBySeries = new Map<string, Match>()
  for (const match of matches) {
    matchesBySeries.set(seriesKey(match.myChar, match.playedAt), match)
  }

  const groups = new Map<string, RatingPoint[]>()
  for (const point of points) {
    const key = point.character ?? ''
    const group = groups.get(key)
    if (group) group.push(point)
    else groups.set(key, [point])
  }

  const result: RatingPoint[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.observedAt - b.observedAt || a.id - b.id)
    group.forEach((point, index) => {
      if (point.source !== 'battlelog') return
      if (!matchesBySeries.has(seriesKey(point.character, point.observedAt))) return
      const next = group[index + 1]
      result.push(next ? { ...point, value: next.value } : point)
    })
  }

  return result.sort((a, b) => a.observedAt - b.observedAt || a.id - b.id)
}

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
