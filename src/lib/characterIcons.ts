const ALIASES: Record<string, string> = {
  'a.k.i.': 'aki',
  aki: 'aki',
  'm. bison': 'm-bison',
  'c. viper': 'c-viper',
  'e. honda': 'e-honda',
  'edmond honda': 'e-honda',
  honda: 'e-honda',
  'dee jay': 'dee-jay',
  'chun-li': 'chun-li',
  jp: 'jp'
}

const COMPACT_ALIASES: Record<string, string> = {
  aki: 'aki',
  mbison: 'm-bison',
  cviper: 'c-viper',
  ehonda: 'e-honda',
  edmondhonda: 'e-honda',
  honda: 'e-honda',
  deejay: 'dee-jay',
  chunli: 'chun-li',
  jp: 'jp'
}

export function characterSlug(name: string | null): string | null {
  if (!name) return null
  const key = name.trim().toLowerCase()
  if (!key) return null
  const alias = ALIASES[key] ?? COMPACT_ALIASES[key.replace(/[^a-z0-9]/g, '')]
  if (alias) return alias
  return key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function characterIconSrc(name: string | null): string | null {
  const slug = characterSlug(name)
  if (!slug) return null
  return `${import.meta.env.BASE_URL}characters/${slug}.png`
}
