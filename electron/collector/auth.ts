import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { LoginResult } from '../../shared/types'

export const BUCKLER_HOME = 'https://www.streetfighter.com/6/buckler/'

const LOGIN_WAIT_MS = 10 * 60 * 1000
const CDP_WAIT_MS = 20_000

export function battleLogUrl(shortId: string, page = 1): string {
  return `https://www.streetfighter.com/6/buckler/profile/${shortId}/battlelog/rank?page=${page}`
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

export interface SavedCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: 'Strict' | 'Lax' | 'None'
}

export interface SavedUaBrand {
  brand: string
  version: string
}

export interface SavedUaData {
  brands: SavedUaBrand[]
  fullVersionList?: SavedUaBrand[]
  mobile: boolean
  platform: string
  platformVersion?: string
  architecture?: string
  bitness?: string
  model?: string
  wow64?: boolean
}

export interface SavedSessionState {
  version: 1
  savedAt: number
  cookies: SavedCookie[]
  userAgent: string
  language: string
  uaData: SavedUaData | null
}

export interface LoginOptions {
  channel?: string
  timeoutMs?: number
  expectedShortId?: string
  onProgress?: (message: string) => void
}

interface ActiveLogin {
  child: ChildProcess
  port: number
  browser: Browser | null
}

interface BrowserCandidate {
  path: string
  name: string
}

let activeLogin: ActiveLogin | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const browserCandidates = (channel?: string): BrowserCandidate[] => {
  const chromeRoots = [
    process.env['PROGRAMFILES'],
    process.env['PROGRAMFILES(X86)'],
    process.env['LOCALAPPDATA']
  ].filter((value): value is string => Boolean(value))

  const chrome = chromeRoots.map((root) => ({
    path: join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    name: 'Chrome'
  }))

  const edgeRoots = [
    process.env['PROGRAMFILES(X86)'],
    process.env['PROGRAMFILES'],
    process.env['LOCALAPPDATA']
  ].filter((value): value is string => Boolean(value))

  const edge = edgeRoots.map((root) => ({
    path: join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    name: 'Edge'
  }))

  if (channel === 'msedge' || channel === 'edge') return edge
  if (channel === 'chrome') return chrome
  return [...chrome, ...edge]
}

const findBrowserExecutable = (channel?: string): BrowserCandidate | null =>
  browserCandidates(channel).find((candidate) => existsSync(candidate.path)) ?? null

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })

const waitForCdp = async (port: number, child: ChildProcess): Promise<void> => {
  const deadline = Date.now() + CDP_WAIT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error('Chrome 启动后立即退出，请检查是否有其他 Chrome 占用该配置目录')
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // port not ready yet
    }
    await sleep(250)
  }
  throw new Error('Chrome 调试端口未就绪')
}

export async function closeActiveLogin(): Promise<void> {
  const login = activeLogin
  activeLogin = null
  if (!login) return
  if (login.child.exitCode === null) {
    login.child.kill()
  }
  await login.browser?.close().catch(() => undefined)
}

export async function openChromeLogin(
  profileDir: string,
  options: LoginOptions = {}
): Promise<LoginResult> {
  if (activeLogin) {
    return { ok: true, message: '登录窗口已经打开，请在其中完成登录' }
  }

  const executable = findBrowserExecutable(options.channel)
  if (!executable) {
    return { ok: false, message: '未找到 Chrome 或 Edge，请先安装 Chrome' }
  }

  mkdirSync(profileDir, { recursive: true })
  const port = await getFreePort()
  options.onProgress?.('正在打开 Chrome…')

  const child = spawn(
    executable.path,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
      BUCKLER_HOME
    ],
    { stdio: 'ignore' }
  )

  try {
    await Promise.race([
      waitForCdp(port, child),
      new Promise<never>((_, reject) => {
        child.once('error', reject)
      })
    ])
  } catch (error) {
    if (child.exitCode === null) child.kill()
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }

  activeLogin = { child, port, browser: null }
  return {
    ok: true,
    message: 'Chrome 已打开：请手动登录 CAPCOM ID 并完成人机验证，登录成功后会自动继续'
  }
}

interface DetectedIds {
  nav: string[]
  all: string[]
}

const detectShortIds = async (page: Page): Promise<DetectedIds> => {
  try {
    const result = await page.evaluate(() => {
      const collect = (anchors: HTMLAnchorElement[]): string[] => {
        const found: string[] = []
        for (const anchor of anchors) {
          const match = /\/profile\/(\d+)(?:\/|$)/.exec(anchor.href)
          if (match?.[1] && match[1] !== '0') found.push(match[1])
        }
        return [...new Set(found)]
      }
      const navAnchors = Array.from(
        document.querySelectorAll('header a, nav a')
      ) as HTMLAnchorElement[]
      const allAnchors = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
      return { nav: collect(navAnchors), all: collect(allAnchors) }
    })
    return result
  } catch {
    return { nav: [], all: [] }
  }
}

const isBucklerHome = (url: string): boolean => /\/6\/buckler\/(?:[a-z-]+\/)?$/i.test(url)

interface LoginState {
  loggedIn: boolean
  shortId?: string
}

const readLoginState = async (page: Page): Promise<LoginState> => {
  try {
    return await page.evaluate(() => {
      const script = document.getElementById('__NEXT_DATA__')
      if (!script?.textContent) return { loggedIn: false }
      const data = JSON.parse(script.textContent) as {
        props?: {
          pageProps?: {
            common?: { loginUser?: { flg?: boolean } & Record<string, unknown> }
          }
        }
      }
      const user = data.props?.pageProps?.common?.loginUser
      if (!user || user.flg !== true) return { loggedIn: false }
      const raw = JSON.stringify(user)
      const match = /"(?:short_?id|user_?code)"\s*:\s*"?(\d+)"?/i.exec(raw)
      return match?.[1] ? { loggedIn: true, shortId: match[1] } : { loggedIn: true }
    })
  } catch {
    return { loggedIn: false }
  }
}

const shortIdFromUrl = (url: string): string | undefined => {
  const match = /\/profile\/(\d+)(?:\/|$)/.exec(url)
  return match?.[1] && match[1] !== '0' ? match[1] : undefined
}

const waitForLoginInContext = async (
  context: BrowserContext,
  timeoutMs: number,
  expectedShortId?: string,
  onProgress?: (message: string) => void
): Promise<string | undefined> => {
  const deadline = Date.now() + timeoutMs
  let challengeReported = false

  while (Date.now() < deadline) {
    if (activeLogin && activeLogin.child.exitCode !== null) {
      return undefined
    }

    const pages = context.pages().filter((page) => !page.isClosed())
    for (const page of pages) {
      const snapshot = await page
        .evaluate(() => ({
          text: document.body?.innerText ?? '',
          title: document.title
        }))
        .catch(() => ({ text: '', title: '' }))

      if (
        /performing security verification|security service to protect|verif(y|ying) (that )?you are (a )?human|just a moment|人机验证/i.test(
          `${snapshot.title}\n${snapshot.text}`
        )
      ) {
        if (!challengeReported) {
          challengeReported = true
          onProgress?.('检测到人机验证：请在 Chrome 窗口中手动完成验证')
        }
        continue
      }

      const loginState = await readLoginState(page)
      const loggedIn =
        loginState.loggedIn ||
        /log\s*out|logout|sign\s*out|ログアウト|登出|注销|註銷|退出/i.test(snapshot.text)
      if (!loggedIn) continue
      if (loginState.shortId) return loginState.shortId

      const url = page.url()
      const fromUrl = shortIdFromUrl(url)
      const ids = await detectShortIds(page)
      if (expectedShortId) {
        if (url.includes(expectedShortId) || fromUrl === expectedShortId) return expectedShortId
        if (ids.all.includes(expectedShortId)) return expectedShortId
        continue
      }

      if (ids.nav.length > 0) return ids.nav[0]
      if (isBucklerHome(url) && ids.all.length > 0) return ids.all[0]
    }

    await sleep(2000)
  }

  return undefined
}

const captureSession = async (
  context: BrowserContext,
  pages: Page[]
): Promise<SavedSessionState> => {
  const page =
    pages.find((entry) => /streetfighter\.com/i.test(entry.url())) ??
    pages[0] ??
    (await context.newPage())

  const meta = await page
    .evaluate(async () => {
      const nav = navigator as Navigator & {
        userAgentData?: {
          brands: Array<{ brand: string; version: string }>
          mobile: boolean
          platform: string
          getHighEntropyValues: (hints: string[]) => Promise<Record<string, unknown>>
        }
      }
      const uaData = nav.userAgentData
      if (!uaData) {
        return {
          userAgent: navigator.userAgent,
          language: navigator.languages?.join(',') || navigator.language || 'zh-CN',
          uaData: null
        }
      }

      const high = await uaData.getHighEntropyValues([
        'fullVersionList',
        'platformVersion',
        'architecture',
        'bitness',
        'model',
        'wow64'
      ])

      return {
        userAgent: navigator.userAgent,
        language: navigator.languages?.join(',') || navigator.language || 'zh-CN',
        uaData: {
          brands: uaData.brands,
          mobile: uaData.mobile,
          platform: uaData.platform,
          fullVersionList: high['fullVersionList'] as
            Array<{ brand: string; version: string }> | undefined,
          platformVersion: high['platformVersion'] as string | undefined,
          architecture: high['architecture'] as string | undefined,
          bitness: high['bitness'] as string | undefined,
          model: high['model'] as string | undefined,
          wow64: high['wow64'] as boolean | undefined
        }
      }
    })
    .catch(async () => ({
      userAgent: await page.evaluate(() => navigator.userAgent).catch(() => ''),
      language: 'zh-CN',
      uaData: null
    }))

  const rawCookies = await context.cookies()
  const cookies: SavedCookie[] = rawCookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite
  }))

  return {
    version: 1,
    savedAt: Date.now(),
    cookies,
    userAgent: meta.userAgent,
    language: meta.language,
    uaData: meta.uaData
  }
}

const saveSessionFile = (sessionPath: string, state: SavedSessionState): void => {
  mkdirSync(dirname(sessionPath), { recursive: true })
  const tempPath = `${sessionPath}.tmp`
  writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tempPath, sessionPath)
}

export function loadSavedSession(sessionPath: string): SavedSessionState {
  const raw = readFileSync(sessionPath, 'utf8')
  const state = JSON.parse(raw) as SavedSessionState
  if (!Array.isArray(state.cookies) || state.cookies.length === 0 || !state.userAgent) {
    throw new Error('登录态文件不完整，请重新登录')
  }
  return state
}

export function hasSavedSession(sessionPath: string): boolean {
  try {
    const state = loadSavedSession(sessionPath)
    return state.cookies.some((cookie) => /streetfighter\.com|capcom\.com/i.test(cookie.domain))
  } catch {
    return false
  }
}

export async function completeChromeLogin(
  sessionPath: string,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const login = activeLogin
  if (!login) {
    return { ok: false, message: '登录窗口未打开，请先点击“登录”' }
  }

  const timeoutMs = options.timeoutMs ?? LOGIN_WAIT_MS
  try {
    options.onProgress?.('正在连接 Chrome 登录窗口…')
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${login.port}/`)
    login.browser = browser
    const context = browser.contexts()[0]
    if (!context) {
      return { ok: false, message: '未找到 Chrome 会话' }
    }

    options.onProgress?.('请在 Chrome 中完成 CAPCOM ID 登录和人机验证…')
    const shortId = await waitForLoginInContext(
      context,
      timeoutMs,
      options.expectedShortId,
      options.onProgress
    )
    if (!shortId) {
      return { ok: false, message: '未检测到登录成功，请重试' }
    }

    const state = await captureSession(context, context.pages())
    saveSessionFile(sessionPath, state)
    return { ok: true, shortId, message: '登录成功，登录态已保存' }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    await closeActiveLogin()
  }
}

export async function loginWithChrome(
  profileDir: string,
  sessionPath: string,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const opened = await openChromeLogin(profileDir, options)
  if (!opened.ok) return opened
  return completeChromeLogin(sessionPath, options)
}

export function cookieUrl(cookie: SavedCookie): string {
  const host = cookie.domain.replace(/^\./, '')
  return `${cookie.secure ? 'https' : 'http'}://${host}${cookie.path || '/'}`
}
