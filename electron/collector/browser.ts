import { existsSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext } from 'playwright'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export interface LaunchOptions {
  headless: boolean
  channel?: string
}

export async function launchBrowser(options: LaunchOptions): Promise<Browser> {
  const candidates: Array<string | undefined> = options.channel
    ? [options.channel]
    : ['chrome', 'msedge', undefined]
  let lastError: unknown

  for (const channel of candidates) {
    try {
      return await chromium.launch({
        headless: options.headless,
        channel,
        args: ['--disable-blink-features=AutomationControlled']
      })
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error('没有可用的浏览器')
}

export async function createContext(
  browser: Browser,
  statePath?: string
): Promise<BrowserContext> {
  const context = await browser.newContext({
    storageState: statePath && existsSync(statePath) ? statePath : undefined,
    locale: 'en-US',
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
    timezoneId: 'America/New_York',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  })

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  return context
}
