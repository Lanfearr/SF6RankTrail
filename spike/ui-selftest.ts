import assert from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import { Repository } from '../electron/db/repository'

const main = async (): Promise<void> => {
  const userData = mkdtempSync(join(tmpdir(), 'sf6-ui-selftest-'))
  const shortId = '1713108118'
  const start = Date.now() - 10 * 60 * 1000
  const seed = new DatabaseSync(join(userData, 'sf6scorer.db'))
  seed.exec('PRAGMA foreign_keys = ON')
  seed.exec(readFileSync('electron/db/schema.sql', 'utf8'))
  const seedRepo = new Repository(seed)
  seedRepo.upsertPlayer({
    shortId,
    cfn: shortId,
    displayName: '测试账号',
    isSelf: true
  })
  seedRepo.insertRating({
    shortId,
    character: 'Ryu',
    kind: 'MR',
    value: 1800,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId,
    character: 'Ryu',
    kind: 'LP',
    value: 12000,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId,
    character: 'Ken',
    kind: 'MR',
    value: 1795,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId,
    character: 'Ken',
    kind: 'LP',
    value: 12050,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId,
    character: 'Cammy',
    kind: 'MR',
    value: 1815,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId,
    character: 'Cammy',
    kind: 'LP',
    value: 12075,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.startSession(shortId, start)
  const seedMatches = [
    { replayId: 'ui-1', myChar: 'Ryu', oppChar: 'Ken', result: 'win' as const, mr: 1800, lp: 12000 },
    { replayId: 'ui-2', myChar: 'Ken', oppChar: 'Chun-Li', result: 'loss' as const, mr: 1795, lp: 12050 },
    { replayId: 'ui-3', myChar: 'Cammy', oppChar: 'A.K.I.', result: 'win' as const, mr: 1815, lp: 12075 },
    { replayId: 'ui-4', myChar: 'Ryu', oppChar: 'JP', result: 'loss' as const, mr: 1810, lp: 12025 },
    { replayId: 'ui-5', myChar: 'Cammy', oppChar: 'M. Bison', result: 'win' as const, mr: 1830, lp: 12125 }
  ]
  seedMatches.forEach((match, index) => {
    const at = start + (index + 1) * 60 * 1000
    seedRepo.insertMatch({
      replayId: match.replayId,
      shortId,
      opponentId: `opp-${index}`,
      myChar: match.myChar,
      oppChar: match.oppChar,
      result: match.result,
      myMr: match.mr,
      oppMr: 1800,
      myLp: match.lp,
      playedAt: at,
      season: null,
      createdAt: at
    })
    seedRepo.insertRating({
      shortId,
      character: match.myChar,
      kind: 'MR',
      value: match.mr,
      source: 'battlelog',
      estimated: false,
      observedAt: at
    })
    seedRepo.insertRating({
      shortId,
      character: match.myChar,
      kind: 'LP',
      value: match.lp,
      source: 'battlelog',
      estimated: false,
      observedAt: at
    })
  })
  const currentAt = start + 12 * 60 * 1000
  for (const point of [
    { character: 'Ryu', kind: 'MR' as const, value: 1785 },
    { character: 'Ryu', kind: 'LP' as const, value: 11985 },
    { character: 'Ken', kind: 'MR' as const, value: 1775 },
    { character: 'Ken', kind: 'LP' as const, value: 12010 },
    { character: 'Cammy', kind: 'MR' as const, value: 1850 },
    { character: 'Cammy', kind: 'LP' as const, value: 12175 }
  ]) {
    seedRepo.insertRating({
      shortId,
      character: point.character,
      kind: point.kind,
      value: point.value,
      source: 'snapshot',
      estimated: false,
      observedAt: currentAt
    })
  }
  seed.close()

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await app.firstWindow()
    await window.waitForSelector('.titlebar', { timeout: 15_000 })
    assert.equal(await window.textContent('.brand'), 'SF6 Scorer')
    assert.equal(await window.isVisible('.mini'), true)
    await window.waitForFunction(
      () => document.querySelector('.rating-value')?.textContent === '1,850',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.textContent('.delta'), '本会话 +35 MR')

    await window.click('.rating-tabs button:has-text("LP")')
    await window.waitForFunction(
      () => document.querySelector('.rating-value')?.textContent === '12,175',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.textContent('.delta'), '本会话 +100 LP')

    await window.click('button:has-text("Pro")')
    await window.waitForSelector('.pro', { timeout: 5_000 })
    assert.equal(await window.isVisible('.mini'), false)

    const size = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]
      return target ? target.getSize() : null
    })
    assert.deepEqual(size, [960, 660])

    assert.equal(await window.textContent('.session-gain'), '+35MR')
    assert.equal(await window.textContent('.session-kind'), 'MR')
    await window.waitForFunction(
      () => (document.querySelector('.toolbar select') as HTMLSelectElement)?.value === 'Cammy',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.locator('.chart-wrap').getAttribute('data-series-count'), '1')

    await window.selectOption('.toolbar select', 'all')
    await window.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-series-count') === '3',
      undefined,
      { timeout: 5_000 }
    )
    await window.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-icon-count') === '5',
      undefined,
      { timeout: 5_000 }
    )
    await window.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-delta-count') === '5',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.locator('.opp-icon').count(), 5)
    assert.equal(
      await window.locator('.opp-delta').allTextContents().then((items) => items.join(',')),
      '+20,-25,+15,-20,+10'
    )
    assert.equal(
      await window.locator('.chart-delta').allTextContents().then((items) => items.join(',')),
      '+10,+15,-25,-20,+20'
    )
    const iconSrc = await window.locator('.opp-icon img').first().getAttribute('src')
    assert.equal(Boolean(iconSrc?.includes('characters/m-bison.png')), true)

    const winBorder = await window
      .locator('.opp-icon.win')
      .first()
      .evaluate((el) => getComputedStyle(el).borderColor)
    const lossBorder = await window
      .locator('.opp-icon.loss')
      .first()
      .evaluate((el) => getComputedStyle(el).borderColor)
    const winDelta = await window
      .locator('.opp-delta.win')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    const lossDelta = await window
      .locator('.opp-delta.loss')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    assert.equal(winBorder, 'rgb(34, 197, 94)')
    assert.equal(lossBorder, 'rgb(239, 68, 68)')
    assert.equal(winDelta, 'rgb(34, 197, 94)')
    assert.equal(lossDelta, 'rgb(239, 68, 68)')

    await window.click('.toolbar .pills button:has-text("LP")')
    await window.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent === '+100LP',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.textContent('.session-kind'), 'LP')
    await window.click('.toolbar .pills button:has-text("MR")')
    await window.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent === '+35MR',
      undefined,
      { timeout: 5_000 }
    )

    const inputs = window.locator('.add-player input')
    await inputs.nth(0).fill('999999999')
    await inputs.nth(1).fill('临时昵称')
    await window.click('.add-player button:has-text("添加")')
    const tag = window.locator('.player-tag[title="999999999"]')
    await tag.waitFor({ timeout: 5_000 })
    assert.equal(await tag.locator('.tag-name').textContent(), '临时昵称')
    assert.equal(await tag.locator('.tag-id').textContent(), '999999999')
    await tag.locator('.tag-remove').click()
    await tag.waitFor({ state: 'detached', timeout: 5_000 })
    assert.equal(await window.locator('.player-tag').count(), 1)

    await window.click('.session-hero button:has-text("刷新")')
    await window.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent?.startsWith('0'),
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await window.locator('.session-kind').textContent(), 'MR')

    await window.click('button:has-text("Mini")')
    await window.waitForSelector('.mini', { timeout: 5_000 })
    assert.equal(await window.isVisible('.pro'), false)

    const overlay = await window.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:8765/overlay')
      const html = await response.text()
      return { status: response.status, hasCard: html.includes('class="card"') }
    })
    assert.equal(overlay.status, 200)
    assert.equal(overlay.hasCard, true)

    console.log('[ui-selftest] OK', { size })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('[ui-selftest] FAILED:', error)
  process.exitCode = 1
})
