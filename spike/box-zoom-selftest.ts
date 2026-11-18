import assert from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import { Repository } from '../electron/db/repository'

const DAY_MS = 86_400_000

const main = async (): Promise<void> => {
  const userData = mkdtempSync(join(tmpdir(), 'sf6-box-zoom-'))
  const historyId = 'history-account'
  const start = Date.now() - 400 * DAY_MS
  const seed = new DatabaseSync(join(userData, 'sf6scorer.db'))
  seed.exec('PRAGMA foreign_keys = ON')
  seed.exec(readFileSync('electron/db/schema.sql', 'utf8'))
  const repo = new Repository(seed)
  repo.upsertPlayer({
    shortId: historyId,
    cfn: historyId,
    displayName: '历史账号',
    isSelf: true
  })
  repo.insertRating({
    shortId: historyId,
    character: 'Ryu',
    kind: 'MR',
    value: 2000,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  for (let index = 1; index <= 24; index += 1) {
    const at = start + index * 15 * DAY_MS
    const mr = 2000 + (index % 2 === 0 ? index : -index)
    repo.insertMatch({
      replayId: `history-${index}`,
      shortId: historyId,
      opponentId: `opp-${index}`,
      opponentName: `Opponent ${index}`,
      myChar: 'Ryu',
      oppChar: index % 2 === 0 ? 'Ken' : 'Cammy',
      result: index % 3 === 0 ? 'loss' : 'win',
      myMr: mr,
      oppMr: 2000,
      myLp: null,
      oppLp: null,
      playedAt: at,
      season: null,
      createdAt: at
    })
    repo.insertRating({
      shortId: historyId,
      character: 'Ryu',
      kind: 'MR',
      value: mr,
      source: 'battlelog',
      estimated: false,
      observedAt: at
    })
  }
  repo.rebuildSessions(historyId)
  seed.close()

  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`],
    env: { ...process.env, SF6_SCORER_DISABLE_SINGLE_INSTANCE: '1' }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForSelector('.main-shell', { timeout: 15_000 })
    await window.selectOption('.account-select select', historyId)
    await window.waitForSelector('.overview-chart-panel .chart-wrap', { timeout: 8_000 })
    await window.click('.overview-chart-controls button:has-text("箱型图")')
    await window.waitForFunction(
      () =>
        document
          .querySelector('.overview-chart-panel .chart-wrap')
          ?.getAttribute('data-box-unit') === 'month',
      undefined,
      { timeout: 5_000 }
    )

    const chartBox = await window.locator('.overview-chart-panel .chart').boundingBox()
    if (!chartBox) throw new Error('box chart missing')
    await window.mouse.move(
      chartBox.x + chartBox.width * 0.5,
      chartBox.y + chartBox.height * 0.45
    )

    let sawWeek = false
    let wheels = 0
    for (let index = 0; index < 60; index += 1) {
      await window.mouse.wheel(0, -600)
      await window.waitForTimeout(220)
      wheels = index + 1
      const unit = await window
        .locator('.overview-chart-panel .chart-wrap')
        .getAttribute('data-box-unit')
      if (unit === 'week') sawWeek = true
      if (unit === 'day') break
    }

    const finalUnit = await window
      .locator('.overview-chart-panel .chart-wrap')
      .getAttribute('data-box-unit')
    assert.equal(sawWeek, true)
    assert.equal(finalUnit, 'day')
    console.log('[box-zoom-selftest] OK', { wheels })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

void main()
