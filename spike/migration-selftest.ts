import assert from 'node:assert'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, SCHEMA_VERSION } from '../electron/db/migrate'
import { Repository } from '../electron/db/repository'
import type { Match } from '../shared/types'

const legacySchema = `
  CREATE TABLE players (
    short_id      TEXT PRIMARY KEY,
    cfn           TEXT,
    display_name  TEXT,
    is_self       INTEGER NOT NULL DEFAULT 0,
    last_synced   INTEGER,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE matches (
    replay_id     TEXT PRIMARY KEY,
    short_id      TEXT NOT NULL REFERENCES players(short_id),
    opponent_id   TEXT,
    my_char       TEXT,
    opp_char      TEXT,
    result        TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
    my_mr         INTEGER,
    opp_mr        INTEGER,
    my_lp         INTEGER,
    played_at     INTEGER NOT NULL,
    season        TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE rating_points (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    short_id      TEXT NOT NULL REFERENCES players(short_id),
    character     TEXT,
    kind          TEXT NOT NULL CHECK (kind IN ('MR','LP')),
    value         INTEGER NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('battlelog','snapshot')),
    estimated     INTEGER NOT NULL DEFAULT 0,
    observed_at   INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    short_id      TEXT NOT NULL REFERENCES players(short_id),
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    start_rating  INTEGER,
    end_rating    INTEGER
  );

  CREATE TABLE session_marks (
    short_id      TEXT PRIMARY KEY REFERENCES players(short_id),
    started_at    INTEGER NOT NULL,
    start_mr      INTEGER,
    start_lp      INTEGER,
    updated_at    INTEGER NOT NULL
  );

  CREATE TABLE settings (
    key           TEXT PRIMARY KEY,
    value         TEXT NOT NULL
  );
`

const schema = readFileSync('electron/db/schema.sql', 'utf8')
const directory = mkdtempSync(join(tmpdir(), 'sf6-migration-selftest-'))
const file = join(directory, 'legacy.db')

try {
  const legacy = new DatabaseSync(file)
  legacy.exec('PRAGMA foreign_keys = ON')
  legacy.exec(legacySchema)
  legacy
    .prepare(
      `INSERT INTO players (short_id, cfn, display_name, is_self, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run('A', 'Player A', null, 1, 1)
  legacy
    .prepare(
      `INSERT INTO players (short_id, cfn, display_name, is_self, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run('B', 'Player B', null, 0, 1)

  const insertLegacyMatch = legacy.prepare(
    `INSERT INTO matches
       (replay_id, short_id, opponent_id, my_char, opp_char, result,
        my_mr, opp_mr, my_lp, played_at, season, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  insertLegacyMatch.run('shared', 'A', 'OPP', 'Ryu', 'Ken', 'win', 1800, 1780, 12000, 1000, null, 1)
  insertLegacyMatch.run('a-2', 'A', 'OPP', 'Ken', 'Ryu', 'loss', 1810, 1830, 12050, 2000, null, 2)

  const insertLegacyRating = legacy.prepare(
    `INSERT INTO rating_points
       (short_id, character, kind, value, source, estimated, observed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  insertLegacyRating.run('A', 'Ryu', 'MR', 1800, 'battlelog', 0, 1000)
  insertLegacyRating.run('A', 'Ken', 'MR', 1810, 'battlelog', 0, 2000)
  insertLegacyRating.run('A', 'Ken', 'MR', 1830, 'snapshot', 0, 3000)
  legacy.close()

  const first = openDatabase(file, schema)
  assert.equal(first.migrated, true, 'legacy database must report a migration')
  const repo = new Repository(first.db)

  const userVersion = first.db.prepare('PRAGMA user_version').get() as { user_version: number }
  assert.equal(userVersion.user_version, SCHEMA_VERSION)

  const primaryKey = (
    first.db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string; pk: number }>
  )
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name)
  assert.deepEqual(primaryKey, ['short_id', 'replay_id'])

  const matchColumns = (
    first.db.prepare('PRAGMA table_info(matches)').all() as Array<{ name: string }>
  ).map((column) => column.name)
  assert.equal(matchColumns.includes('opponent_name'), true)

  const sessionColumns = (
    first.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
  ).map((column) => column.name)
  const markColumns = (
    first.db.prepare('PRAGMA table_info(session_marks)').all() as Array<{ name: string }>
  ).map((column) => column.name)
  assert.equal(sessionColumns.includes('character'), true)
  assert.equal(markColumns.includes('character'), true)
  assert.equal(sessionColumns.includes('start_lp'), true)
  assert.equal(sessionColumns.includes('end_lp'), true)

  assert.equal(repo.listMatches({ shortId: 'A' }).length, 2)
  repo.rebuildAllSessions()
  const history = repo.listSessionHistory('A')
  assert.equal(history.length, 1)
  assert.equal(history[0]?.character, 'Ken', 'session character must be the last match character')
  assert.equal(history[0]?.startRating, 1810)
  assert.equal(history[0]?.endRating, 1830)
  assert.equal(history[0]?.ratingDelta, 20)

  const secondAccountMatch: Match = {
    replayId: 'shared',
    shortId: 'B',
    opponentId: 'OPP-B',
    opponentName: 'Opponent B',
    myChar: 'Cammy',
    oppChar: 'Juri',
    result: 'win',
    myMr: 1900,
    oppMr: 1880,
    myLp: null,
    oppLp: null,
    playedAt: 4000,
    season: null,
    createdAt: 4000
  }
  assert.equal(repo.insertMatch(secondAccountMatch), true)
  assert.equal(repo.hasMatch('A', 'shared'), true)
  assert.equal(repo.hasMatch('B', 'shared'), true)
  assert.equal(repo.listMatches({ shortId: 'A' }).length, 2)
  assert.equal(repo.listMatches({ shortId: 'B' }).length, 1)

  const backups = readdirSync(join(directory, 'backups')).filter((name) => name.endsWith('.db'))
  assert.equal(backups.length, 1, 'migration must create one pre-migration backup')
  first.db.close()

  const reopened = openDatabase(file, schema)
  assert.equal(reopened.migrated, false, 'reopening a migrated database must not migrate again')
  const reopenedRepo = new Repository(reopened.db)
  assert.equal(reopenedRepo.listMatches({ shortId: 'A' }).length, 2)
  assert.equal(reopenedRepo.listMatches({ shortId: 'B' }).length, 1)
  reopened.db.close()

  console.log('[migration-selftest] OK')
} finally {
  rmSync(directory, { recursive: true, force: true })
}
