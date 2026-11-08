import { existsSync } from 'node:fs'
import type { Browser, BrowserContext } from 'playwright'
import type { Match } from '../../shared/types'
import { battleLogUrl, extractNextData } from './auth'
import { createContext, launchBrowser } from './browser'
import { parseBattleLog } from './parser'

export interface MatchSource {
  fetchMatches(shortId: string): Promise<Match[]>
}

export class BattleLogSource implements MatchSource {
  private browser: Browser | null = null
  private context: BrowserContext | null = null

  constructor(
    private readonly statePath: string,
    private readonly channel?: string,
    private readonly headless = true
  ) {}

  private async ensureContext(): Promise<BrowserContext> {
    if (this.context) return this.context
    this.browser = await launchBrowser({ headless: this.headless, channel: this.channel })
    this.context = await createContext(this.browser, this.statePath)
    return this.context
  }

  async fetchMatches(shortId: string): Promise<Match[]> {
    const context = await this.ensureContext()
    const page = await context.newPage()

    try {
      const response = await page.goto(battleLogUrl(shortId), {
        waitUntil: 'domcontentloaded',
        timeout: 60_000
      })

      if (response?.status() === 403) {
        const hasSession = existsSync(this.statePath)
        throw new Error(
          hasSession
            ? 'Buckler 403：可能被风控拦截，或该账号不可访问'
            : '未登录（或该账号不可访问）：请先完成 CAPCOM ID 登录'
        )
      }
      if (response && !response.ok()) {
        throw new Error(`Buckler HTTP ${response.status()}`)
      }
      if (/login|signin|sign-in/i.test(page.url())) {
        throw new Error('登录态失效，请重新登录')
      }

      await page.waitForTimeout(1500)
      const html = await page.content()
      const data = extractNextData(html)
      if (!data) return []
      return parseBattleLog(data, shortId)
    } finally {
      await page.close().catch(() => undefined)
    }
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined)
    this.browser = null
    this.context = null
  }
}
