import assert from 'node:assert'
import { _electron as electron } from 'playwright'

const main = async (): Promise<void> => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const window = await app.firstWindow()
    await window.waitForSelector('.titlebar', { timeout: 15_000 })
    assert.equal(await window.textContent('.brand'), 'SF6 Scorer')
    assert.equal(await window.isVisible('.mini'), true)

    await window.click('button:has-text("Pro")')
    await window.waitForSelector('.pro', { timeout: 5_000 })
    assert.equal(await window.isVisible('.mini'), false)

    const size = await app.evaluate(({ BrowserWindow }) => {
      const target = BrowserWindow.getAllWindows()[0]
      return target ? target.getSize() : null
    })
    assert.deepEqual(size, [960, 660])

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
  }
}

main().catch((error) => {
  console.error('[ui-selftest] FAILED:', error)
  process.exitCode = 1
})
