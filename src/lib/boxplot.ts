import type { RatingPoint } from '@shared/types'
import { buildCharacterRatingDeltas, seriesKey } from './ratings'

export type BoxUnit = 'day' | 'week' | 'month'
export type BoxMetric = 'delta' | 'rating'

export interface BoxSample {
  at: number
  value: number
  character: string
}

export interface BoxPeriod {
  start: number
  end: number
  center: number
  label: string
  title: string
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
  count: number
}

export interface CharacterBoxPeriods {
  character: string
  periods: BoxPeriod[]
}

const DAY_MS = 86_400_000
const MAX_DAY_SPAN_MS = 35 * DAY_MS
const MAX_WEEK_SPAN_MS = 210 * DAY_MS

export const BOX_UNIT_LABEL: Record<BoxUnit, string> = {
  day: '日',
  week: '周',
  month: '月'
}

export const BOX_METRIC_LABEL: Record<BoxMetric, string> = {
  delta: '变化量',
  rating: '分数'
}

export function selectBoxUnit(spanMs: number): BoxUnit {
  if (!Number.isFinite(spanMs) || spanMs <= MAX_DAY_SPAN_MS) return 'day'
  if (spanMs <= MAX_WEEK_SPAN_MS) return 'week'
  return 'month'
}

export function buildBoxSamples(
  points: RatingPoint[],
  ratingPoints: RatingPoint[],
  metric: BoxMetric
): BoxSample[] {
  const deltas = metric === 'delta' ? buildCharacterRatingDeltas(ratingPoints) : null
  const samples: BoxSample[] = []
  for (const point of points) {
    const character = point.character ?? '未知角色'
    if (metric === 'delta') {
      const delta = deltas?.get(seriesKey(point.character, point.observedAt))
      if (delta === undefined || !Number.isFinite(delta)) continue
      samples.push({ at: point.observedAt, value: delta, character })
    } else if (Number.isFinite(point.value)) {
      samples.push({ at: point.observedAt, value: point.value, character })
    }
  }
  return samples
}

export function buildCharacterBoxPeriods(
  samples: BoxSample[],
  unit: BoxUnit
): CharacterBoxPeriods[] {
  const grouped = new Map<string, Map<number, BoxSample[]>>()
  for (const sample of samples) {
    let periods = grouped.get(sample.character)
    if (!periods) {
      periods = new Map()
      grouped.set(sample.character, periods)
    }
    const start = periodStart(sample.at, unit)
    const bucket = periods.get(start)
    if (bucket) bucket.push(sample)
    else periods.set(start, [sample])
  }

  const result: CharacterBoxPeriods[] = []
  for (const [character, periods] of grouped) {
    const boxes: BoxPeriod[] = []
    for (const [start, bucket] of periods) {
      const values = bucket.map((sample) => sample.value).sort((a, b) => a - b)
      const end = nextPeriodStart(start, unit)
      boxes.push({
        start,
        end,
        center: start + (end - start) / 2,
        label: formatBoxAxisLabel(start, unit),
        title: formatBoxPeriodTitle(start, end, unit),
        min: values[0] ?? 0,
        q1: quantile(values, 0.25),
        median: quantile(values, 0.5),
        q3: quantile(values, 0.75),
        max: values[values.length - 1] ?? 0,
        mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
        count: values.length
      })
    }
    boxes.sort((a, b) => a.start - b.start)
    result.push({ character, periods: boxes })
  }
  return result
}

export function quantile(sortedValues: number[], ratio: number): number {
  if (sortedValues.length === 0) return 0
  if (sortedValues.length === 1) return sortedValues[0] ?? 0
  const position = (sortedValues.length - 1) * ratio
  const base = Math.floor(position)
  const rest = position - base
  const low = sortedValues[base] ?? 0
  const high = sortedValues[Math.min(sortedValues.length - 1, base + 1)] ?? low
  return low + (high - low) * rest
}

function periodStart(at: number, unit: BoxUnit): number {
  const date = new Date(at)
  if (unit === 'month') {
    date.setDate(1)
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }
  if (unit === 'week') {
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  }
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function nextPeriodStart(start: number, unit: BoxUnit): number {
  const date = new Date(start)
  if (unit === 'day') date.setDate(date.getDate() + 1)
  else if (unit === 'week') date.setDate(date.getDate() + 7)
  else date.setMonth(date.getMonth() + 1)
  return date.getTime()
}

export function formatBoxAxisLabel(at: number, unit: BoxUnit): string {
  const date = new Date(at)
  if (unit === 'month') return `${date.getFullYear()}/${date.getMonth() + 1}`
  return `${date.getMonth() + 1}/${date.getDate()}`
}

export function formatBoxPeriodTitle(start: number, end: number, unit: BoxUnit): string {
  const startDate = new Date(start)
  if (unit === 'month') return `${startDate.getFullYear()}年${startDate.getMonth() + 1}月`
  const lastDate = new Date(end - 1)
  if (unit === 'day') {
    return `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`
  }
  return `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()} – ${lastDate.getMonth() + 1}/${lastDate.getDate()}`
}
