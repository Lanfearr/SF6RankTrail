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

db.close()
console.log('[db-selftest] OK')
