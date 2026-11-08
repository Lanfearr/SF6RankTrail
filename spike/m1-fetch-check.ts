import { BattleLogSource } from '../electron/collector/fetcher'

const main = async (): Promise<void> => {
  const source = new BattleLogSource('spike/out/no-storage.json')
  try {
    const matches = await source.fetchMatches('1234567890')
    console.log(`[m1-fetch] fetched matches=${matches.length}`)
  } catch (error) {
    console.log('[m1-fetch] expected failure:', error instanceof Error ? error.message : error)
  } finally {
    await source.close()
  }
}

main().catch((error) => {
  console.error('[m1-fetch] unexpected:', error)
  process.exitCode = 1
})
