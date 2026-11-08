import { readFileSync } from 'node:fs'
import { createContext, launchBrowser } from './browser'
import type { BrowserContext, Page } from 'playwright'
import type { LoginResult } from '../../shared/types'

export interface SessionHandle {
  browser: Awaited<ReturnType<typeof launchBrowser>>
  context: BrowserContext
}

export function battleLogUrl(shortId: string, page = 1): string {
  return `https://www.streetfighter.com/6/buckler/profile/${shortId}/battlelog/rank?page=${page}`
}

export const BUCKLER_HOME = 'https://www.streetfighter.com/6/buckler/'

export async function openSession(
  statePath: string,
  headless: boolean,
  channel?: string
): Promise<SessionHandle> {
  const browser = await launchBrowser({ headless, channel })
  const context = await createContext(browser, statePath)
  return { browser, context }
}

export async function saveSession(context: BrowserContext, statePath: string): Promise<void> {
  await context.storageState({ path: statePath })
}

export async function isLoggedIn(shortId: string, context: BrowserContext): Promise<boolean> {
  const page = await context.newPage()
  try {
    const response = await page.goto(battleLogUrl(shortId), {
      waitUntil: 'domcontentloaded',
      timeout: 30_000
    })
    if (!response) return false
    if (/login|signin|sign-in/i.test(page.url())) return false
    return response.ok()
  } finally {
    await page.close()
  }
}

export function extractNextData(html: string): unknown {
  const match = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!match) return null
  try {
    return JSON.parse(match[1] ?? '')
  } catch {
    return null
  }
}

const detectShortIds = async (page: Page): Promise<string[]> => {
  try {
    const ids = await page.evaluate(() => {
      const found: string[] = []
      const anchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
      for (const anchor of anchors) {
        const match = /\/profile\/(\d+)(?:\/|$)/.exec(anchor.href)
        if (match?.[1] && match[1] !== '0') found.push(match[1])
      }
      return found
    })
    return [...new Set(ids)]
  } catch {
    return []
  }
}

const waitForLogin = async (
  page: Page,
  timeoutMs: number,
  expectedShortId?: string
): Promise<string | undefined> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (page.isClosed()) return undefined

    if (expectedShortId && page.url().includes(expectedShortId)) {
      return expectedShortId
    }

    const ids = await detectShortIds(page)
    if (expectedShortId) {
      if (ids.includes(expectedShortId)) return expectedShortId
    } else if (ids.length > 0) {
      return ids[0]
    }

    const loggedIn = await page
      .evaluate(() => /log\s*out|logout|sign\s*out/i.test(document.body.innerText))
      .catch(() => false)
    if (loggedIn && expectedShortId) return expectedShortId

    await page.waitForTimeout(1500)
  }
  return undefined
}

export interface LoginOptions {
  channel?: string
  timeoutMs?: number
  expectedShortId?: string
}

export async function loginInteractively(
  statePath: string,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const timeoutMs = options.timeoutMs ?? 300_000
  const browser = await launchBrowser({ headless: false, channel: options.channel })

  try {
    const context = await createContext(browser, statePath)
    const page = await context.newPage()
    await page.goto(BUCKLER_HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 })

    const shortId = await waitForLogin(page, timeoutMs, options.expectedShortId)
    if (!shortId) {
      return {
        ok: false,
        message: '未检测到登录账号，请重试，或先填写 short_id 再登录'
      }
    }

    await saveSession(context, statePath)
    return { ok: true, shortId }
  } finally {
    await browser.close().catch(() => undefined)
  }
}

export function readStorageState(statePath: string): boolean {
  try {
    readFileSync(statePath)
    return true
  } catch {
    return false
  }
}
