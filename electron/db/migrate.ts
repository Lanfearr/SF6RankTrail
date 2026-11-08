import { DatabaseSync } from 'node:sqlite'
import schema from './schema.sql?raw'

export type Db = DatabaseSync

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(schema)
  return db
}
