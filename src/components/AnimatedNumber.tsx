import { useEffect, useRef, useState } from 'react'

interface Props {
  value: number | null
  className?: string
}

export function AnimatedNumber({ value, className }: Props) {
  const [display, setDisplay] = useState<number | null>(value)
  const fromRef = useRef<number | null>(value)

  useEffect(() => {
    if (value === null) {
      setDisplay(null)
      fromRef.current = null
      return
    }

    const from = fromRef.current ?? value
    const to = value
    const startedAt = performance.now()
    const duration = 550
    let frame = 0

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (progress < 1) {
        frame = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  if (display === null) return <span className={className}>—</span>
  return <span className={className}>{display.toLocaleString()}</span>
}
