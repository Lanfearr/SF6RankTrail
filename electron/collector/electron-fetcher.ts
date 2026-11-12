import { session, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import type { CurrentRating, Match } from '../../shared/types'
import {
  battleLogUrl,
  cookieUrl,
  extractNextData,
  profileUrl,
  type SavedCookie,
  type SavedSessionState
} from './auth'
import type { MatchSource } from './fetcher'
import {
  parseBattleLog,
  parseCurrentRatings,
  readBattleLogPageInfo,
  readPlayerName
} from './parser'
import { isRetryableStatus, parseRetryAfter, retryDelayMs } from './retry'

const PARTITION = 'persist:sf6-buckler'
const MAX_BACKFILL_PAGES = 200
const PAGE_DELAY_MS = 600
const MAX_ATTEMPTS = 3

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const SAME_SITE: Record<SavedCookie['sameSite'], 'strict' | 'lax' | 'no_restriction'> = {
  Strict: 'strict',
  Lax: 'lax',
  None: 'no_restriction'
}

const buildHeaders = (state: SavedSessionState): Record<string, string> => {
  const headers: Record<string, string> = {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': state.language || 'zh-CN,zh;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer: 'https://www.streetfighter.com/6/buckler/',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1'
  }

  const uaData = state.uaData
  if (uaData?.brands?.length) {
    const full = uaData.fullVersionList?.length ? uaData.fullVersionList : uaData.brands
    headers['sec-ch-ua'] = full.map((entry) => `"${entry.brand}";v="${entry.version}"`).join(', ')
    headers['sec-ch-ua-mobile'] = uaData.mobile ? '?1' : '?0'
    headers['sec-ch-ua-platform'] = `"${uaData.platform}"`
    if (uaData.fullVersionList?.length) {
      headers['sec-ch-ua-full-version-list'] = uaData.fullVersionList
        .map((entry) => `"${entry.brand}";v="${entry.version}"`)
        .join(', ')
    }
  }

  return headers
}

export class ElectronBucklerSource implements MatchSource {
  private readonly ses: Session
  private readonly playerNames = new Map<string, string>()
  private ready: Promise<SavedSessionState> | null = null

  constructor(private readonly sessionPath: string) {
    this.ses = session.fromPartition(PARTITION)
  }

  private ensureSession(): Promise<SavedSessionState> {
    if (!this.ready) {
      this.ready = this.loadSession().catch((error) => {
        this.ready = null
        throw error
      })
    }
    return this.ready
  }

  private async loadSession(): Promise<SavedSessionState> {
    const raw = await readFile(this.sessionPath, 'utf8')
    const state = JSON.parse(raw) as SavedSessionState
    if (!Array.isArray(state.cookies) || state.cookies.length === 0 || !state.userAgent) {
      throw new Error('登录态文件不完整，请重新登录')
    }

    await this.ses.clearStorageData({ storages: ['cookies'] })
    for (const cookie of state.cookies) {
      try {
        await this.ses.cookies.set({
          url: cookieUrl(cookie),
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path,
          secure: cookie.secure,
          httpOnly: cookie.httpOnly,
          expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
          sameSite: SAME_SITE[cookie.sameSite] ?? 'lax'
        })
      } catch {
        // Some Cloudflare partitioned cookies cannot be restored; keep the rest.
      }
    }

    this.ses.setUserAgent(state.userAgent, state.language || 'zh-CN,zh;q=0.9')
    return state
  }

  private async fetchDocument(url: string): Promise<unknown> {
    const state = await this.ensureSession()

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response
      try {
        response = await this.ses.fetch(url, {
          headers: buildHeaders(state),
          redirect: 'follow'
        })
      } catch (error) {
        if (attempt + 1 >= MAX_ATTEMPTS) throw error
        await sleep(retryDelayMs(attempt))
        continue
      }

      if (response.status === 403) {
        throw new Error('登录态无效或 Cloudflare 风控拦截，请重新登录')
      }
      if (response.status === 401) {
        throw new Error('登录已过期，请重新登录')
      }
      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt + 1 < MAX_ATTEMPTS) {
          await response.body?.cancel().catch(() => undefined)
          await sleep(
            retryDelayMs(attempt, parseRetryAfter(response.headers.get('retry-after')))
          )
          continue
        }
        const retried = attempt > 0 ? `（已重试 ${attempt} 次）` : ''
        throw new Error(`Buckler HTTP ${response.status}${retried}`)
      }
      if (/login|signin|sign-in/i.test(response.url)) {
        throw new Error('登录态失效，请重新登录')
      }

      const html = await response.text()
      if (
        /performing security verification|security service to protect|verif(y|ying) (that )?you are (a )?human/i.test(
          html
        )
      ) {
        throw new Error('Cloudflare 人机验证拦截，请重新登录')
      }
      if (/"page":"[^"]*(?:auth|login|signin)[^"]*"/i.test(html)) {
        throw new Error('登录态失效，请重新登录')
      }

      const data = extractNextData(html)
      if (!data) {
        throw new Error('页面结构变化：未找到 __NEXT_DATA__，请检查 Buckler 是否改版')
      }
      return data
    }

    throw new Error('Buckler 请求失败')
  }

  private async fetchPage(
    shortId: string,
    page: number
  ): Promise<{ matches: Match[]; totalPages: number | null; playerName: string | null }> {
    const data = await this.fetchDocument(battleLogUrl(shortId, page))
    const playerName = readPlayerName(data, shortId)
    if (playerName) this.playerNames.set(shortId, playerName)
    return {
      matches: parseBattleLog(data, shortId),
      totalPages: readBattleLogPageInfo(data).totalPages,
      playerName
    }
  }

  getPlayerName(shortId: string): string | null {
    return this.playerNames.get(shortId) ?? null
  }

  async fetchMatches(shortId: string, page = 1): Promise<Match[]> {
    return (await this.fetchPage(shortId, page)).matches
  }

  async fetchCurrentRatings(shortId: string): Promise<CurrentRating[]> {
    const data = await this.fetchDocument(profileUrl(shortId))
    const playerName = readPlayerName(data, shortId)
    if (playerName) this.playerNames.set(shortId, playerName)
    return parseCurrentRatings(data)
  }

  async fetchAllMatches(shortId: string): Promise<Match[]> {
    const all = new Map<string, Match>()
    const seen = new Set<string>()
    let totalPages: number | null = null

    for (let page = 1; page <= MAX_BACKFILL_PAGES; page += 1) {
      const result = await this.fetchPage(shortId, page)
      if (result.totalPages !== null && result.totalPages > 0) {
        totalPages = result.totalPages
      }
      if (result.matches.length === 0) break

      const signature = result.matches
        .map((match) => match.replayId)
        .sort()
        .join('|')
      if (seen.has(signature)) break
      seen.add(signature)

      for (const match of result.matches) all.set(match.replayId, match)
      if (totalPages !== null && page >= totalPages) break
      await sleep(PAGE_DELAY_MS)
    }

    return [...all.values()]
  }

  async close(): Promise<void> {
    // Electron session is process-wide; nothing to release here.
  }
}
