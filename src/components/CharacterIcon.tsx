import { useEffect, useState } from 'react'
import type { MatchResult } from '@shared/types'
import { characterIconSrc } from '../lib/characterIcons'
import { formatDelta } from '../lib/format'

interface Props {
  name: string | null
  result: MatchResult
  delta?: number | null
}

const initialsFor = (name: string | null): string => {
  if (!name) return '?'
  const initials = name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return initials || '?'
}

export function CharacterIcon({ name, result, delta }: Props) {
  const [failed, setFailed] = useState(false)
  const src = characterIconSrc(name)

  useEffect(() => {
    setFailed(false)
  }, [name])

  return (
    <span className={`opp-icon ${result}`}>
      {src && !failed ? (
        <img src={src} alt={name ?? '对手'} onError={() => setFailed(true)} />
      ) : (
        <span className="opp-icon-fallback">{initialsFor(name)}</span>
      )}
      {delta !== null && delta !== undefined && (
        <span className={`opp-delta ${result}`}>{formatDelta(delta)}</span>
      )}
    </span>
  )
}
