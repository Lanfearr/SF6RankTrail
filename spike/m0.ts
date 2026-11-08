import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import type { Match } from '../shared/types'
import {
  BUCKLER_HOME,
  battleLogUrl,
  extractNextData,
  hasSavedSession,
  loginWithChrome
} from '../electron/collector/auth'
import {
  findBattleLogArrays,
  normalizeMatch,
  parseBattleLog,
  readBattleLogPageInfo
} from '../electron/collector/parser'

interface Args {
  [key: string]: string | boolean
}

const parseArgs = (argv: string[]): Args => {
  const out: Args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      out[key] = true
    } else {
      out[key] = next
      i += 1
    }
  }
  return out
}

const selfTest = (): void => {
  const sample = {
    props: {
      pageProps: {
        battlelog: [
          {
            replay_id: 'demo-1',
            player1_info: {
              player: { short_id: 'SELF' },
              character_name: 'Ryu',
              master_rating: 1800,
              round_results: [1, 2]
            },
            player2_info: {
              player: { short_id: 'OTHER' },
              character_name: 'Ken',
              master_rating: 1750,
              round_results: [0, 0]
            },
            played_at: '2026-11-08T10:00:00Z'
          }
        ]
      }
    }
  }
  const matches = parseBattleLog(sample, 'SELF')
  if (matches.length !== 1)
    throw new Error(`self-test failed: expected 1 match, got ${matches.length}`)
  const match = matches[0] as Match
  if (match.result !== 'win') throw new Error(`self-test failed: expected win, got ${match.result}`)
  if (match.myMr !== 1800) throw new Error(`self-test failed: expected MR 1800, got ${match.myMr}`)
  const pageInfo = readBattleLogPageInfo({
    props: { pageProps: { pagination: { total_pages: 3, current_page: 1 } } }
  })
  if (pageInfo.totalPages !== 3) {
    throw new Error(`self-test failed: expected 3 pages, got ${pageInfo.totalPages}`)
  }
  const secondsMatch = normalizeMatch(
    {
      replay_id: 'seconds-test',
      uploaded_at: 1794067878,
      player1_info: {
        player: { short_id: 'SELF' },
        round_results: [1, 1],
        playing_character_name: 'Ryu'
      },
      player2_info: {
        player: { short_id: 'OTHER' },
        round_results: [0, 0],
        playing_character_name: 'Ken'
      }
    },
    'SELF'
  )
  if (secondsMatch?.playedAt !== 1794067878000) {
    throw new Error(`self-test failed: expected uploaded_at seconds, got ${secondsMatch?.playedAt}`)
  }
  console.log('[self-test] parser OK:', JSON.stringify(match))
}

const saveCaptured = (
  outDir: string,
  candidates: Array<{ label: string; payload: unknown; count: number }>
): void => {
  mkdirSync(outDir, { recursive: true })
  candidates.forEach((candidate, index) => {
    writeFileSync(
      join(outDir, `candidate-${index}`, 'payload.json'),
      JSON.stringify(candidate.payload, null, 2)
    )
  })
  const summary = candidates.map((candidate) => ({
    label: candidate.label,
    count: candidate.count
  }))
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  if (args['self-test']) {
    selfTest()
    return
  }

  const shortId =
    typeof args['short-id'] === 'string'
      ? args['short-id']
      : typeof args['cfn'] === 'string'
        ? args['cfn']
        : process.env['SF6_SHORT_ID']
  const sessionPath = resolve(
    typeof args['session'] === 'string' ? args['session'] : 'spike/out/session.json'
  )
  const profileDir = resolve(
    typeof args['profile'] === 'string' ? args['profile'] : 'spike/out/chrome-profile'
  )
  const outDir = resolve('spike/out')
  const headless = Boolean(args['headless'])
  const dump = Boolean(args['dump'])
  const channel = typeof args['channel'] === 'string' ? args['channel'] : 'chrome'
  const executablePath =
    typeof args['executable-path'] === 'string' ? args['executable-path'] : undefined

  if (!hasSavedSession(sessionPath)) {
    const login = await loginWithChrome(profileDir, sessionPath, { channel })
    console.log(`[m0] ${login.message ?? ''}`)
    if (!login.ok) {
      process.exitCode = 1
      return
    }
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    channel,
    executablePath,
    args: ['--disable-blink-features=AutomationControlled']
  })
  const page = context.pages()[0] ?? (await context.newPage())

  if (args['probe']) {
    const response = await page.goto(BUCKLER_HOME, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000
    })
    console.log(`[probe] status=${response?.status()} url=${page.url()}`)
    console.log(`[probe] title=${await page.title()}`)
    await context.close()
    return
  }

  const captured: Array<{ url: string; body: unknown }> = []
  page.on('response', async (response) => {
    const contentType = (response.headers()['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('json')) return
    if (!/streetfighter\.com|capcom|buckler/i.test(response.url())) return
    try {
      captured.push({ url: response.url(), body: await response.json() })
    } catch {
      // non-JSON body despite content-type; ignore
    }
  })

  const target = shortId ? battleLogUrl(shortId) : BUCKLER_HOME
  console.log(`[m0] 打开 ${target}`)
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 })

  if (!shortId) {
    console.log('[m0] 已登录。请带 --short-id <Buckler ID> 重新运行以抓取战绩。')
    await context.close()
    return
  }

  console.log(`[m0] 抓取战绩页 ${battleLogUrl(shortId)}`)
  await page.goto(battleLogUrl(shortId), { waitUntil: 'networkidle', timeout: 60_000 })
  await page.waitForTimeout(1500)

  const html = await page.content()
  const nextData = extractNextData(html)

  const candidates: Array<{ label: string; payload: unknown; count: number }> = []
  if (nextData) {
    const matches = shortId ? parseBattleLog(nextData, shortId) : []
    candidates.push({ label: 'next-data', payload: nextData, count: matches.length })
  }
  captured.forEach((entry, index) => {
    const arrays = findBattleLogArrays(entry.body)
    if (arrays.length === 0) return
    const matches = shortId ? parseBattleLog(entry.body, shortId) : []
    candidates.push({
      label: `response-${index} ${entry.url}`,
      payload: entry.body,
      count: matches.length
    })
  })

  const merged = new Map<string, Match>()
  for (const candidate of candidates) {
    if (!shortId) continue
    for (const match of parseBattleLog(candidate.payload, shortId)) {
      merged.set(match.replayId, match)
    }
  }

  console.log('\n[m0] 候选数据源:')
  if (candidates.length === 0) {
    console.log('  (无) 未找到 __NEXT_DATA__ 或含战绩的 JSON 响应')
  }
  candidates.forEach((candidate) => {
    console.log(`  - ${candidate.label}  matches=${candidate.count}`)
  })

  const matches = [...merged.values()].sort((a, b) => b.playedAt - a.playedAt)
  console.log(`\n[m0] 解析结果: ${matches.length} 场对局`)
  for (const match of matches.slice(0, 10)) {
    const time = new Date(match.playedAt).toLocaleString()
    console.log(
      `  ${time}  ${match.result.toUpperCase()}  ${match.myChar ?? '?'} vs ${match.oppChar ?? '?'}  MR=${match.myMr ?? '-'}`
    )
  }

  if (dump || matches.length === 0) {
    saveCaptured(outDir, candidates)
    writeFileSync(join(outDir, 'page.html'), html)
    console.log(`\n[m0] 原始数据已写入 ${outDir}`)
  }

  await context.close()

  if (matches.length === 0) {
    console.log('[m0] 未解析出对局。请检查 spike/out/page.html 与 candidate-*/payload.json，')
    console.log('     确认 Buckler 当前页面结构后调整 parseBattleLog。')
    process.exitCode = 2
  }
}

main().catch((error) => {
  console.error('[m0] 失败:', error)
  process.exitCode = 1
})
