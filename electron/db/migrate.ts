import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type Db = DatabaseSync

export interface OpenDatabaseResult {
  db: Db
  migrated: boolean
}

export const SCHEMA_VERSION = 1

const tableExists = (db: Db, table: string): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  )

const columnNames = (db: Db, table: string): string[] => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

const primaryKeyColumns = (db: Db, table: string): string[] => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string
    pk: number
  }>
  return rows
    .filter((row) => row.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((row) => row.name)
}

const readUserVersion = (db: Db): number => {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

const ensureColumn = (db: Db, table: string, column: string, ddl: string): void => {
  if (!columnNames(db, table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

const backupBeforeMigration = (db: Db, file: string): void => {
  if (file === ':memory:' || !existsSync(file)) return
  const directory = join(dirname(file), 'backups')
  mkdirSync(directory, { recursive: true })
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(file, join(directory, `pre-migration-v${SCHEMA_VERSION}-${stamp}.db`))
}

const migrateMatchesPrimaryKey = (db: Db): void => {
  const primaryKey = primaryKeyColumns(db, 'matches')
  if (primaryKey.length === 2 && primaryKey[0] === 'short_id' && primaryKey[1] === 'replay_id') {
    return
  }
  if (primaryKey.length !== 1 || primaryKey[0] !== 'replay_id') {
    throw new Error(`不支持的 matches 主键结构：${primaryKey.join(', ') || '无主键'}`)
  }

  const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as
    | { foreign_keys?: number }
    | undefined
  db.exec('PRAGMA foreign_keys = OFF;')
  db.exec('BEGIN IMMEDIATE;')
  try {
    db.exec(`
      CREATE TABLE matches_new (
        replay_id     TEXT NOT NULL,
        short_id      TEXT NOT NULL REFERENCES players(short_id),
        opponent_id   TEXT,
        opponent_name TEXT,
        my_char       TEXT,
        opp_char      TEXT,
        result        TEXT NOT NULL CHECK (result IN ('win','loss','draw')),
        my_mr         INTEGER,
        opp_mr        INTEGER,
        my_lp         INTEGER,
        opp_lp        INTEGER,
        played_at     INTEGER NOT NULL,
        season        TEXT,
        created_at    INTEGER NOT NULL,
        PRIMARY KEY (short_id, replay_id)
      );
    `)
    db.exec(`
      INSERT INTO matches_new
        (replay_id, short_id, opponent_id, opponent_name, my_char, opp_char, result,
         my_mr, opp_mr, my_lp, opp_lp, played_at, season, created_at)
      SELECT
        replay_id, short_id, opponent_id, opponent_name, my_char, opp_char, result,
        my_mr, opp_mr, my_lp, opp_lp, played_at, season, created_at
      FROM matches;
    `)
    db.exec('DROP TABLE matches;')
    db.exec('ALTER TABLE matches_new RENAME TO matches;')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_matches_short_time
        ON matches(short_id, played_at DESC);
    `)
    db.exec('COMMIT;')
  } catch (error) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      // ignore rollback failure and preserve the original error
    }
    throw error
  } finally {
    db.exec(`PRAGMA foreign_keys = ${foreignKeys?.foreign_keys === 0 ? 'OFF' : 'ON'};`)
  }
}

const assertDatabaseHealthy = (db: Db): void => {
  const foreignKeyIssues = db.prepare('PRAGMA foreign_key_check').all()
  if (foreignKeyIssues.length > 0) {
    throw new Error('数据库外键检查失败，已停止启动')
  }
  const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{
    integrity_check: string
  }>
  if (integrity.some((row) => row.integrity_check !== 'ok')) {
    throw new Error('数据库完整性检查失败，已停止启动')
  }
}

export function openDatabase(file: string, schema: string): OpenDatabaseResult {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec('PRAGMA foreign_keys = ON;')

    const version = readUserVersion(db)
    if (version > SCHEMA_VERSION) {
      throw new Error(`数据库版本 ${version} 高于程序支持的版本 ${SCHEMA_VERSION}`)
    }

    const hadMatches = tableExists(db, 'matches')
    const matchPrimaryKey = hadMatches ? primaryKeyColumns(db, 'matches') : []
    const needsMatchesRebuild =
      hadMatches &&
      !(
        matchPrimaryKey.length === 2 &&
        matchPrimaryKey[0] === 'short_id' &&
        matchPrimaryKey[1] === 'replay_id'
      )
    const hadSessions = tableExists(db, 'sessions')
    const hadSessionMarks = tableExists(db, 'session_marks')
    const needsCharacterColumns =
      (hadSessions && !columnNames(db, 'sessions').includes('character')) ||
      (hadSessionMarks && !columnNames(db, 'session_marks').includes('character'))
    const needsWork = needsMatchesRebuild || needsCharacterColumns

    if (needsWork) backupBeforeMigration(db, file)

    db.exec(schema)
    ensureColumn(db, 'matches', 'opp_lp', 'opp_lp INTEGER')
    ensureColumn(db, 'matches', 'opponent_name', 'opponent_name TEXT')
    ensureColumn(db, 'sessions', 'start_lp', 'start_lp INTEGER')
    ensureColumn(db, 'sessions', 'end_lp', 'end_lp INTEGER')
    ensureColumn(db, 'sessions', 'character', 'character TEXT')
    ensureColumn(db, 'session_marks', 'character', 'character TEXT')

    if (needsMatchesRebuild) migrateMatchesPrimaryKey(db)

    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`)
    assertDatabaseHealthy(db)
    return { db, migrated: needsWork }
  } catch (error) {
    try {
      db.close()
    } catch {
      // preserve the original startup error
    }
    throw error
  }
}
