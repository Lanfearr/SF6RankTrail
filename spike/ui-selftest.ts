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
  const bulkId = 'bulk-account'
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

  seedRepo.upsertPlayer({
    shortId: bulkId,
    cfn: bulkId,
    displayName: '批量账号'
  })
  seedRepo.insertRating({
    shortId: bulkId,
    character: 'Cammy',
    kind: 'MR',
    value: 2000,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  seedRepo.insertRating({
    shortId: bulkId,
    character: 'Cammy',
    kind: 'LP',
    value: 13000,
    source: 'battlelog',
    estimated: false,
    observedAt: start
  })
  for (let index = 1; index <= 25; index += 1) {
    const at = start + index * 60 * 1000
    const mr = 2000 + index * 2
    const lp = 13000 + index * 3
    seedRepo.insertMatch({
      replayId: `bulk-${index}`,
      shortId: bulkId,
      opponentId: `bulk-opp-${index}`,
      myChar: 'Cammy',
      oppChar: index % 2 === 0 ? 'Ryu' : 'Ken',
      result: index % 3 === 0 ? 'loss' : 'win',
      myMr: mr,
      oppMr: 2000,
      myLp: lp,
      playedAt: at,
      season: null,
      createdAt: at
    })
    seedRepo.insertRating({
      shortId: bulkId,
      character: 'Cammy',
      kind: 'MR',
      value: mr,
      source: 'battlelog',
      estimated: false,
      observedAt: at
    })
    seedRepo.insertRating({
      shortId: bulkId,
      character: 'Cammy',
      kind: 'LP',
      value: lp,
      source: 'battlelog',
      estimated: false,
      observedAt: at
    })
  }
  seedRepo.insertRating({
    shortId: bulkId,
    character: 'Cammy',
    kind: 'MR',
    value: 2100,
    source: 'snapshot',
    estimated: false,
    observedAt: start + 26 * 60 * 1000
  })
  seedRepo.insertRating({
    shortId: bulkId,
    character: 'Cammy',
    kind: 'LP',
    value: 13100,
    source: 'snapshot',
    estimated: false,
    observedAt: start + 26 * 60 * 1000
  })
  seed.close()

  const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] })
  try {
    const window = await app.firstWindow()
    await window.waitForSelector('.main-shell', { timeout: 15_000 })
    assert.equal(await window.textContent('.main-brand strong'), 'SF6 Scorer')

    const nav = await window.locator('.nav-item').allTextContents()
    assert.deepEqual(nav, [
      '概览',
      '对战记录',
      '对战详情',
      '角色统计',
      '赛季报告',
      '数据导出 / 备份',
      '数据同步',
      '设置'
    ])
    assert.equal(nav[nav.length - 1], '设置')
    assert.equal(await window.textContent('.page-title'), '概览')
    await window.waitForFunction(
      () => document.querySelector('.stat-value')?.textContent === '1,850',
      undefined,
      { timeout: 5_000 }
    )
    await window.click('.nav-item:has-text("对战记录")')
    await window.waitForSelector('.match-table-row', { timeout: 5_000 })
    assert.equal(await window.locator('.match-table-row').count(), 5)
    assert.equal(await window.locator('.match-table-row .result').first().textContent(), '胜')

    await window.locator('.match-table-row').first().click()
    await window.waitForSelector('.detail-grid', { timeout: 5_000 })
    assert.equal(await window.textContent('.result-large'), '胜利')
    assert.equal(await window.textContent('.page-title'), '对战详情')

    await window.click('.nav-item:has-text("角色统计")')
    await window.waitForSelector('.stats-table-row', { timeout: 5_000 })
    assert.equal(await window.locator('.stats-table-row').count(), 3)

    await window.click('.nav-item:has-text("赛季报告")')
    await window.waitForSelector('.season-card', { timeout: 5_000 })
    assert.equal(await window.locator('.season-card').count(), 1)

    await window.click('.nav-item:has-text("数据导出 / 备份")')
    await window.waitForSelector('.export-card', { timeout: 5_000 })
    assert.equal(await window.locator('.export-card').count(), 3)

    await window.click('.nav-item:has-text("数据同步")')
    await window.waitForSelector('.stat-card', { timeout: 5_000 })
    assert.equal(await window.textContent('.page-title'), '数据同步')

    await window.click('.nav-item:has-text("设置")')
    await window.waitForSelector('.settings-grid', { timeout: 5_000 })
    assert.equal(await window.locator('.player-tag').count(), 2)

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
    assert.equal(await window.locator('.player-tag').count(), 2)

    const chartPromise = app.waitForEvent('window')
    await window.click('.main-header-actions button:has-text("打开图表")')
    const chart = await chartPromise
    await chart.waitForSelector('.app', { timeout: 10_000 })
    assert.equal(await chart.textContent('.brand'), 'SF6 Scorer')
    assert.equal(await chart.isVisible('.mini'), true)
    await chart.waitForFunction(
      () => document.querySelector('.rating-value')?.textContent === '1,850',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await chart.textContent('.delta'), '本会话 +35 MR')

    await chart.click('.rating-tabs button:has-text("LP")')
    await chart.waitForFunction(
      () => document.querySelector('.rating-value')?.textContent === '12,175',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await chart.textContent('.delta'), '本会话 +100 LP')

    await chart.click('button:has-text("Pro")')
    await chart.waitForSelector('.pro', { timeout: 5_000 })
    assert.equal(await chart.isVisible('.mini'), false)
    await chart.waitForTimeout(300)
    const proSizes = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((target) => target.getSize())
    )
    assert.equal(proSizes.some(([width, height]) => width === 960 && height === 660), true)

    assert.equal(await chart.textContent('.session-gain'), '+35')
    assert.equal(await chart.textContent('.session-kind'), 'MR')
    assert.equal(await chart.textContent('.session-label'), '本次会话净上分')
    await chart.waitForFunction(
      () => (document.querySelector('.toolbar select') as HTMLSelectElement)?.value === 'Cammy',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await chart.locator('.chart-wrap').getAttribute('data-series-count'), '1')

    await chart.selectOption('.toolbar select', 'all')
    await chart.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-series-count') === '3',
      undefined,
      { timeout: 5_000 }
    )
    await chart.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-icon-count') === '5',
      undefined,
      { timeout: 5_000 }
    )
    await chart.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-delta-count') === '5',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(
      await chart.locator('.chart-delta').allTextContents().then((items) => items.join(',')),
      '+10,+15,-25,-20,+20'
    )
    const firstIconSrc = await chart.locator('.chart-icon img').first().getAttribute('src')
    const lastIconSrc = await chart.locator('.chart-icon img').last().getAttribute('src')
    assert.equal(Boolean(firstIconSrc?.includes('characters/ken.png')), true)
    assert.equal(Boolean(lastIconSrc?.includes('characters/m-bison.png')), true)

    const winBorder = await chart
      .locator('.chart-icon.win')
      .first()
      .evaluate((el) => getComputedStyle(el).borderColor)
    const lossBorder = await chart
      .locator('.chart-icon.loss')
      .first()
      .evaluate((el) => getComputedStyle(el).borderColor)
    const winDelta = await chart
      .locator('.chart-delta.win')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    const lossDelta = await chart
      .locator('.chart-delta.loss')
      .first()
      .evaluate((el) => getComputedStyle(el).color)
    assert.equal(winBorder, 'rgb(34, 197, 94)')
    assert.equal(lossBorder, 'rgb(239, 68, 68)')
    assert.equal(winDelta, 'rgb(34, 197, 94)')
    assert.equal(lossDelta, 'rgb(239, 68, 68)')

    await chart.click('.toolbar .pills button:has-text("LP")')
    await chart.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent === '+100',
      undefined,
      { timeout: 5_000 }
    )
    assert.equal(await chart.textContent('.session-kind'), 'LP')
    await chart.click('.toolbar .pills button:has-text("MR")')
    await chart.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent === '+35',
      undefined,
      { timeout: 5_000 }
    )

    const chartBox = await chart.locator('.chart').boundingBox()
    if (!chartBox) throw new Error('chart box missing')
    await chart.mouse.move(
      chartBox.x + chartBox.width * 0.55,
      chartBox.y + chartBox.height * 0.45
    )
    await chart.mouse.wheel(0, -600)
    await chart.waitForFunction(
      () => Number(document.querySelector('.chart-wrap')?.getAttribute('data-icon-count')) < 5,
      undefined,
      { timeout: 5_000 }
    )
    const zoomedIconCount = Number(
      await chart.locator('.chart-wrap').getAttribute('data-icon-count')
    )

    await chart.click('.session-hero button:has-text("刷新")')
    await chart.waitForFunction(
      () => document.querySelector('.session-gain')?.textContent?.startsWith('0'),
      undefined,
      { timeout: 5_000 }
    )
    await chart.waitForTimeout(800)
    assert.equal(
      Number(await chart.locator('.chart-wrap').getAttribute('data-icon-count')),
      zoomedIconCount,
      'chart zoom should survive data refresh'
    )
    assert.equal(await chart.locator('.session-kind').textContent(), 'MR')

    await chart.click('button:has-text("Mini")')
    await chart.waitForSelector('.mini', { timeout: 5_000 })
    assert.equal(await chart.isVisible('.pro'), false)

    await window.selectOption('.account-select select', bulkId)
    await chart.click('button:has-text("Pro")')
    await chart.waitForSelector('.pro', { timeout: 5_000 })
    await chart.waitForFunction(
      () => document.querySelector('.chart-wrap')?.getAttribute('data-icon-count') === '20',
      undefined,
      { timeout: 8_000 }
    )
    assert.equal(
      await chart.locator('.chart-wrap').getAttribute('data-delta-count'),
      '20'
    )
    const statsText = (await chart.textContent('.stats-inline')) ?? ''
    assert.equal(statsText.includes('最近场次'), true)
    assert.equal(statsText.includes('20 场'), true)
    assert.equal(await chart.locator('.chart-wrap').getAttribute('data-series-count'), '1')

    const overlay = await window.evaluate(async () => {
      const response = await fetch('http://127.0.0.1:8765/overlay')
      const html = await response.text()
      return { status: response.status, hasCard: html.includes('class="card"') }
    })
    assert.equal(overlay.status, 200)
    assert.equal(overlay.hasCard, true)

    const chartClosed = chart.waitForEvent('close')
    await chart.click('button:has-text("关闭")')
    await chartClosed
    assert.equal(app.windows().length, 1)

    console.log('[ui-selftest] OK', { proSizes })
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('[ui-selftest] FAILED:', error)
  process.exitCode = 1
})
