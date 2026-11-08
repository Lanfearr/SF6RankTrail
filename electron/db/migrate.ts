import { DatabaseSync } from 'node:sqlite'
import schema from './schema.sql?raw'

export type Db = DatabaseSync

const ensureColumn = (db: Db, table: string, column: string, ddl: string): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
}

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(schema)

  ensureColumn(db, 'sessions', 'start_lp', 'start_lp INTEGER')
  ensureColumn(db, 'sessions', 'end_lp', 'end_lp INTEGER')

  return db
}
