import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Repository } from '../electron/db/repository'

const db = new DatabaseSync(':memory:')
db.exec(readFileSync('electron/db/schema.sql', 'utf8'))
const repo = new Repository(db)

const player = repo.upsertPlayer({ shortId: 'SELF', cfn: 'SelfPlayer', isSelf: true })
console.log('player:', player)

const match = {
  replayId: 'replay-1',
  shortId: 'SELF',
  opponentId: 'OPP',
  myChar: 'Ryu',
  oppChar: 'Ken',
  result: 'win' as const,
  myMr: 1800,
  oppMr: 1750,
  myLp: null,
  playedAt: Date.now(),
  season: null,
  createdAt: Date.now()
}
console.log('insert match:', repo.insertMatch(match))
console.log('insert duplicate (should be false):', repo.insertMatch(match))
console.log('matches:', repo.listMatches({ shortId: 'SELF' }))

const rating = repo.insertRating({
  shortId: 'SELF',
  character: 'Ryu',
  kind: 'MR',
  value: 1800,
  source: 'battlelog',
  estimated: false,
  observedAt: Date.now()
})
console.log('rating:', rating)
console.log('series:', repo.listRatings({ shortId: 'SELF', kind: 'MR' }))

repo.setSetting('theme', 'dark')
console.log('setting:', repo.getSetting('theme'))
console.log('players:', repo.listPlayers())

assert.equal(repo.setDisplayNameIfEmpty('SELF', '昵称'), true)
assert.equal(repo.setDisplayNameIfEmpty('SELF', '其他昵称'), false)
assert.equal(repo.listPlayers()[0]?.displayName, '昵称')

const markStart = Date.now() + 60_000
const started = repo.startSession('SELF', markStart)
assert.equal(started.startedAt, markStart)
assert.equal(started.matches, 0)
assert.equal(started.ratingDelta, 0)
assert.equal(repo.getActiveSession('SELF')?.startedAt, markStart)

repo.insertRating({
  shortId: 'SELF',
  character: 'Ryu',
  kind: 'MR',
  value: 1830,
  source: 'battlelog',
  estimated: false,
  observedAt: markStart + 10
})
repo.insertMatch({
  ...match,
  replayId: 'replay-2',
  myMr: 1830,
  playedAt: markStart + 20,
  createdAt: markStart + 20
})
const manual = repo.getManualSession('SELF')
assert.equal(manual?.matches, 1)
assert.equal(manual?.wins, 1)
assert.equal(manual?.ratingDelta, 30)
assert.equal(repo.getDashboard('SELF')?.session?.ratingDelta, 30)

repo.upsertPlayer({ shortId: 'CURRENT', cfn: 'Current', isSelf: false })
const currentBase = Date.now() + 120_000
repo.insertMatch({
  ...match,
  replayId: 'current-1',
  shortId: 'CURRENT',
  myMr: 1800,
  playedAt: currentBase,
  createdAt: currentBase
})
repo.insertMatch({
  ...match,
  replayId: 'current-2',
  shortId: 'CURRENT',
  myMr: 1810,
  playedAt: currentBase + 10,
  createdAt: currentBase + 10
})
const currentSnapshot = repo.recordCurrentRatings(
  'CURRENT',
  [{ character: 'Ryu', mr: 1780, lp: null }],
  currentBase + 20
)
assert.equal(currentSnapshot.length, 1)
assert.equal(repo.getLatestRating('CURRENT', 'MR')?.value, 1780)
assert.equal(repo.getLatestRating('CURRENT', 'MR', 'Ryu')?.source, 'snapshot')
assert.equal(repo.getLatestMatchCharacter('CURRENT'), 'Ryu')
assert.equal(repo.getDashboard('CURRENT')?.latestMr?.value, 1780)
assert.equal(
  repo.recordCurrentRatings('CURRENT', [{ character: 'Ryu', mr: 1780, lp: null }], currentBase + 30)
    .length,
  0,
  'unchanged current rating should not create duplicate snapshots'
)
repo.insertMatch({
  ...match,
  replayId: 'current-3',
  shortId: 'CURRENT',
  myMr: 1790,
  playedAt: currentBase + 40,
  createdAt: currentBase + 40
})
assert.equal(
  repo.recordCurrentRatings('CURRENT', [{ character: 'Ryu', mr: 1780, lp: null }], currentBase + 50)
    .length,
  1,
  'a new match should refresh the current snapshot even when the value is unchanged'
)
assert.equal(repo.listRatings({ shortId: 'CURRENT', kind: 'MR' }).length, 2)
assert.equal(repo.deletePlayer('CURRENT'), true)

repo.setSetting('backfill:SELF', '1')
assert.equal(repo.deletePlayer('SELF'), true)
assert.equal(repo.deletePlayer('SELF'), false)
assert.equal(repo.listPlayers().length, 0)
assert.equal(repo.listMatches({ shortId: 'SELF' }).length, 0)
assert.equal(repo.listRatings({ shortId: 'SELF', kind: 'MR' }).length, 0)
assert.equal(repo.getManualSession('SELF'), null)
assert.equal(repo.getSetting('backfill:SELF'), null)

db.close()
console.log('[db-selftest] OK')
