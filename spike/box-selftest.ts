import assert from 'node:assert'
import type { RatingPoint } from '../shared/types'
import {
  buildBoxSamples,
  buildCharacterBoxPeriods,
  quantile,
  selectBoxUnit,
  type BoxSample
} from '../src/lib/boxplot'

const DAY_MS = 86_400_000

const point = (
  id: number,
  character: string,
  observedAt: number,
  value: number
): RatingPoint => ({
  id,
  shortId: 'SELF',
  character,
  kind: 'MR',
  value,
  source: 'battlelog',
  estimated: false,
  observedAt
})

const at = (year: number, month: number, day: number, hour = 12): number =>
  new Date(year, month - 1, day, hour).getTime()

assert.equal(selectBoxUnit(10 * DAY_MS), 'day')
assert.equal(selectBoxUnit(35 * DAY_MS), 'day')
assert.equal(selectBoxUnit(36 * DAY_MS), 'week')
assert.equal(selectBoxUnit(210 * DAY_MS), 'week')
assert.equal(selectBoxUnit(211 * DAY_MS), 'month')

assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2)
assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3)
assert.equal(quantile([1, 2, 3, 4, 5], 0.75), 4)
assert.equal(quantile([7], 0.5), 7)

const points = [
  point(1, 'Ryu', at(2026, 1, 5), 1810),
  point(2, 'Ryu', at(2026, 1, 5, 13), 1790),
  point(3, 'Ken', at(2026, 1, 5), 1720)
]
const ratingPoints = [
  point(10, 'Ryu', at(2026, 1, 5), 1800),
  point(11, 'Ryu', at(2026, 1, 5, 13), 1810),
  point(12, 'Ryu', at(2026, 1, 6), 1790),
  point(13, 'Ken', at(2026, 1, 5), 1700),
  point(14, 'Ken', at(2026, 1, 5, 14), 1720)
]

const deltaSamples = buildBoxSamples(points, ratingPoints, 'delta')
assert.deepEqual(
  deltaSamples.map((sample) => [sample.character, sample.value]),
  [
    ['Ryu', 10],
    ['Ryu', -20],
    ['Ken', 20]
  ]
)
const ratingSamples = buildBoxSamples(points, ratingPoints, 'rating')
assert.equal(ratingSamples.length, 3)
assert.equal(ratingSamples[1]?.value, 1790)

const daily = buildCharacterBoxPeriods(ratingSamples, 'day')
assert.deepEqual(
  daily.map((series) => series.character),
  ['Ryu', 'Ken']
)
assert.equal(daily[0]?.periods.length, 1)
assert.deepEqual(
  daily[0]?.periods.map((box) => [box.label, box.count, box.min, box.max]),
  [['1/5', 2, 1790, 1810]]
)
assert.equal(daily[0]?.periods[0]?.median, 1800)
assert.equal(daily[1]?.periods[0]?.median, 1720)

const weekly = buildCharacterBoxPeriods(ratingSamples, 'week')
assert.equal(weekly[0]?.periods.length, 1)
assert.equal(weekly[0]?.periods[0]?.title, '2026/1/5 – 1/11')

const monthly = buildCharacterBoxPeriods(ratingSamples, 'month')
assert.equal(monthly[0]?.periods.length, 1)
assert.equal(monthly[0]?.periods[0]?.title, '2026年1月')

const samples: BoxSample[] = [
  { at: at(2026, 1, 5), value: -2, character: 'Ryu' },
  { at: at(2026, 1, 5, 14), value: 4, character: 'Ryu' },
  { at: at(2026, 1, 5, 16), value: 10, character: 'Ryu' }
]
const box = buildCharacterBoxPeriods(samples, 'day')[0]?.periods[0]
assert.equal(box?.count, 3)
assert.equal(box?.min, -2)
assert.equal(box?.q1, 1)
assert.equal(box?.median, 4)
assert.equal(box?.q3, 7)
assert.equal(box?.max, 10)
assert.equal(box?.mean, 4)

console.log('[box-selftest] OK')
