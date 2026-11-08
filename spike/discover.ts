import { chromium } from 'playwright'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const main = async (): Promise<void> => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--disable-blink-features=AutomationControlled']
  })
  const context = await browser.newContext({
    userAgent: UA,
    locale: 'en-US',
    viewport: { width: 1366, height: 900 },
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })
  const page = await context.newPage()

  for (const url of [
    'https://www.streetfighter.com/6/buckler/ranking',
    'https://www.streetfighter.com/6/buckler/ranking/play',
    'https://www.streetfighter.com/6/buckler/ranking/master'
  ]) {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(2500)
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter((href) => href.includes('/profile/'))
    )
    const unique = [...new Set(links)].slice(0, 8)
    console.log(`\n[discover] ${url} status=${response?.status()} title=${await page.title()}`)
    console.log(`  profile links: ${unique.length}`)
    unique.forEach((link) => console.log(`  - ${link}`))
    if (unique.length > 0) break
  }

  await browser.close()
}

main().catch((error) => {
  console.error('[discover] failed:', error)
  process.exitCode = 1
})
