import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { Repository } from '../electron/db/repository'
import { SyncService, type SyncResult } from '../electron/collector/sync-service'
import type { MatchSource } from '../electron/collector/fetcher'
import type { Match, ServerEvent } from '../shared/types'

const main = async (): Promise<void> => {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync('electron/db/schema.sql', 'utf8'))
  const repo = new Repository(db)
  repo.upsertPlayer({ shortId: 'SELF', cfn: 'Self', isSelf: true })

  const base = Date.now() - 8 * 60 * 60 * 1000
  let seq = 0

  const makeMatch = (
    offsetMinutes: number,
    result: Match['result'],
    mr: number,
    character = 'Ryu'
  ): Match => {
    seq += 1
    return {
      replayId: `replay-${seq}`,
      shortId: 'SELF',
      opponentId: `OPP-${seq}`,
      myChar: character,
      oppChar: 'Ken',
      result,
      myMr: mr,
      oppMr: mr - 20,
      myLp: null,
      playedAt: base + offsetMinutes * 60 * 1000,
      season: null,
      createdAt: Date.now()
    }
  }

  const feed: Match[] = [
    makeMatch(0, 'win', 1800),
    makeMatch(5, 'loss', 1810),
    makeMatch(10, 'win', 1800),
    makeMatch(4 * 60, 'win', 1830)
  ]

  const source: MatchSource = {
    async fetchMatches() {
      return feed
    }
  }

  const events: ServerEvent[] = []
  const statuses: string[] = []
  const service = new SyncService(
    repo,
    source,
    (event) => events.push(event),
    (status) => statuses.push(status.state)
  )

  const first = await service.sync('SELF')
  assert.equal(first.fetched, 4)
  assert.equal(first.inserted, 4)
  assert.equal(repo.listMatches({ shortId: 'SELF' }).length, 4)
  assert.equal(repo.listRatings({ shortId: 'SELF', kind: 'MR' }).length, 4)

  const sessions = repo.listSessions('SELF')
  assert.equal(sessions.length, 2, 'gap >= 3h should split sessions')
  const latest = repo.getLatestSession('SELF')
  assert.equal(latest?.matches, 1)

  const second: SyncResult = await service.sync('SELF')
  assert.equal(second.inserted, 0, 're-sync must not duplicate')
  assert.equal(repo.listMatches({ shortId: 'SELF' }).length, 4)
  assert.equal(repo.listRatings({ shortId: 'SELF', kind: 'MR' }).length, 4)

  feed.push(makeMatch(4 * 60 + 15, 'loss', 1820))
  const third = await service.sync('SELF')
  assert.equal(third.inserted, 1)
  assert.equal(repo.listMatches({ shortId: 'SELF' }).length, 5)
  assert.equal(repo.listRatings({ shortId: 'SELF', kind: 'MR' }).length, 5)

  const latestAfter = repo.getLatestSession('SELF')
  assert.equal(latestAfter?.matches, 2)
  assert.equal(latestAfter?.ratingDelta, 1820 - 1830)

  const matchEvents = events.filter((event) => event.type === 'match:new').length
  assert.equal(matchEvents, 5)

  console.log('[m1-selftest] OK')
  console.log(
    '  scores  :',
    repo.listRatings({ shortId: 'SELF', kind: 'MR' }).map((point) => point.value)
  )
  console.log('  sessions:', sessions.map((session) => `${session.wins}W${session.losses}L`))
  console.log('  latest  :', latestAfter)

  db.close()
}

main().catch((error) => {
  console.error('[m1-selftest] FAILED:', error)
  process.exitCode = 1
})
