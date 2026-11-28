import { app, dialog } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  UpdateCheckResult,
  UpdateInstallResult,
  UpdateProgress,
  UpdateReleaseInfo
} from '../shared/types'
import { compareVersions } from '../shared/version'

const OWNER = 'Lanfearr'
const REPO = 'SF6RankTrail'
const RELEASES_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=10`
const USER_AGENT = 'SF6RankTrail-Updater'
const CHECK_CACHE_MS = 10 * 60 * 1000
const PROGRESS_THROTTLE_MS = 200

interface GitHubAsset {
  name?: unknown
  size?: unknown
  browser_download_url?: unknown
  digest?: unknown
}

interface GitHubRelease {
  tag_name?: unknown
  name?: unknown
  body?: unknown
  draft?: unknown
  prerelease?: unknown
  published_at?: unknown
  assets?: unknown
}

interface ParsedRelease {
  version: string
  release: UpdateReleaseInfo
}

let cachedResult: UpdateCheckResult | null = null
let lastProgress: UpdateProgress | null = null
let downloading = false

type ProgressListener = (progress: UpdateProgress) => void
let progressListener: ProgressListener | null = null

export function onUpdateProgress(listener: ProgressListener): void {
  progressListener = listener
}

function emitProgress(progress: UpdateProgress): void {
  lastProgress = progress
  progressListener?.(progress)
}

export function getLastProgress(): UpdateProgress | null {
  return lastProgress
}

export function getCachedUpdateResult(): UpdateCheckResult | null {
  return cachedResult
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function parseDigest(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const match = /^sha256:([a-f0-9]{64})$/i.exec(raw)
  return match?.[1] ? match[1].toLowerCase() : null
}

function pickAsset(assets: GitHubAsset[], version: string): GitHubAsset | null {
  const usable = assets.filter((asset) => {
    const name = text(asset.name)
    return Boolean(name && name.toLowerCase().endsWith('.exe') && text(asset.browser_download_url))
  })
  if (usable.length === 0) return null

  const exactName = `SF6RankTrail-v${version}-x64.exe`.toLowerCase()
  return (
    usable.find((asset) => (text(asset.name) ?? '').toLowerCase() === exactName) ??
    usable.find((asset) => (text(asset.name) ?? '').toLowerCase().includes('x64')) ??
    usable[0] ??
    null
  )
}

function toParsedRelease(raw: GitHubRelease): ParsedRelease | null {
  if (raw.draft === true || raw.prerelease === true) return null
  const tag = text(raw.tag_name)
  if (!tag) return null
  const version = tag.replace(/^v/i, '')
  const assets = Array.isArray(raw.assets) ? (raw.assets as GitHubAsset[]) : []
  const asset = pickAsset(assets, version)
  const publishedAt = text(raw.published_at)

  return {
    version,
    release: {
      version,
      tag,
      name: text(raw.name),
      notes: text(raw.body),
      publishedAt: publishedAt ? Date.parse(publishedAt) : null,
      assetName: asset ? text(asset.name) : null,
      assetSize: asset ? toNumber(asset.size) : null,
      downloadUrl: asset ? text(asset.browser_download_url) : null,
      sha256: asset ? parseDigest(asset.digest) : null
    }
  }
}

function latestRelease(releases: GitHubRelease[]): ParsedRelease | null {
  let best: ParsedRelease | null = null
  for (const raw of releases) {
    const parsed = toParsedRelease(raw)
    if (!parsed) continue
    if (!best || compareVersions(parsed.version, best.version) > 0) best = parsed
  }
  return best
}

export async function checkForUpdates(force = false): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion()
  if (
    !force &&
    cachedResult &&
    Date.now() - cachedResult.checkedAt < CHECK_CACHE_MS
  ) {
    return cachedResult
  }

  const base: UpdateCheckResult = {
    currentVersion,
    latestVersion: null,
    available: false,
    release: null,
    checkedAt: Date.now(),
    error: null
  }

  try {
    const response = await fetch(RELEASES_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': USER_AGENT
      }
    })
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? '无法读取 GitHub Releases（仓库可能未公开或尚无 Release）'
          : `GitHub 返回 HTTP ${response.status}`
      )
    }
    const payload: unknown = await response.json()
    const releases = Array.isArray(payload) ? (payload as GitHubRelease[]) : []
    const latest = latestRelease(releases)
    if (!latest) {
      cachedResult = { ...base, error: null }
      return cachedResult
    }

    const result: UpdateCheckResult = {
      ...base,
      latestVersion: latest.version,
      available: compareVersions(latest.version, currentVersion) > 0,
      release: latest.release,
      error: null
    }
    cachedResult = result
    return result
  } catch (error) {
    const result: UpdateCheckResult = {
      ...base,
      error: error instanceof Error ? error.message : String(error)
    }
    cachedResult = result
    return result
  }
}

function updatesDir(): string {
  const dir = join(app.getPath('userData'), 'updates')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.-]+/g, '_').trim()
  return cleaned || 'SF6RankTrail-update.exe'
}

async function downloadFile(
  url: string,
  target: string,
  totalBytes: number,
  expectedSha256: string | null
): Promise<void> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/octet-stream' }
  })
  if (!response.ok || !response.body) {
    throw new Error(`下载失败（HTTP ${response.status}）`)
  }

  const length = toNumber(response.headers.get('content-length')) ?? totalBytes
  const hash = createHash('sha256')
  const stream = createWriteStream(target)
  const reader = response.body.getReader()
  let received = 0
  let lastSentAt = 0

  const send = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastSentAt < PROGRESS_THROTTLE_MS) return
    lastSentAt = now
    const percent = length > 0 ? Math.min(100, Math.round((received / length) * 1000) / 10) : 0
    emitProgress({
      phase: 'downloading',
      percent,
      receivedBytes: received,
      totalBytes: length,
      message: '正在下载安装包'
    })
  }

  send(true)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      const chunk = Buffer.from(value)
      hash.update(chunk)
      received += chunk.length
      if (!stream.write(chunk)) {
        await new Promise<void>((resolve) => stream.once('drain', resolve))
      }
      send()
    }
  } finally {
    await new Promise<void>((resolve) => stream.end(() => resolve()))
  }

  emitProgress({
    phase: 'downloading',
    percent: 100,
    receivedBytes: received,
    totalBytes: length || received,
    message: '下载完成'
  })

  if (expectedSha256) {
    emitProgress({
      phase: 'verifying',
      percent: 100,
      receivedBytes: received,
      totalBytes: length || received,
      message: '正在校验安装包'
    })
    const actual = hash.digest('hex')
    if (actual !== expectedSha256) {
      rmSync(target, { force: true })
      throw new Error('安装包校验失败，请重新下载')
    }
  }
}

export async function downloadAndInstallUpdate(): Promise<UpdateInstallResult> {
  if (!app.isPackaged) {
    return { ok: false, message: '开发模式下不支持自动安装，请手动下载安装包' }
  }
  if (downloading) {
    return { ok: false, message: '正在下载更新，请稍候' }
  }

  const result = cachedResult ?? (await checkForUpdates(true))
  if (result.error) return { ok: false, message: result.error }
  const release = result.release
  if (!result.available || !release) {
    return { ok: false, message: '当前已是最新版本' }
  }
  if (!release.downloadUrl || !release.assetName) {
    return { ok: false, message: '该版本没有可用的 Windows 安装包' }
  }

  downloading = true
  const target = join(updatesDir(), safeFileName(release.assetName))
  try {
    await downloadFile(
      release.downloadUrl,
      target,
      release.assetSize ?? 0,
      release.sha256
    )
  } catch (error) {
    emitProgress({
      phase: 'error',
      percent: 0,
      receivedBytes: 0,
      totalBytes: 0,
      message: error instanceof Error ? error.message : String(error)
    })
    downloading = false
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
  }
  downloading = false

  emitProgress({
    phase: 'ready',
    percent: 100,
    receivedBytes: release.assetSize ?? 0,
    totalBytes: release.assetSize ?? 0,
    message: '安装包已就绪'
  })

  const choice = await dialog.showMessageBox({
    type: 'question',
    buttons: ['立即安装', '取消'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: '安装更新',
    message: `已下载 SF6 RankTrail v${release.version}`,
    detail: '点击「立即安装」后本程序将退出，并启动安装向导。'
  })

  if (choice.response !== 0) {
    return { ok: false, message: '已取消安装' }
  }

  emitProgress({
    phase: 'installing',
    percent: 100,
    receivedBytes: release.assetSize ?? 0,
    totalBytes: release.assetSize ?? 0,
    message: '正在启动安装向导'
  })

  const child = spawn(target, [], { detached: true, stdio: 'ignore' })
  child.unref()

  setTimeout(() => app.quit(), 600)
  return { ok: true }
}
