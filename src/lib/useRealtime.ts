import { useEffect } from 'react'
import type { ServerEvent } from '@shared/types'
import { useAppStore } from '../store/useAppStore'

export function useRealtime(): void {
  const applyEvent = useAppStore((state) => state.applyEvent)
  const refresh = useAppStore((state) => state.refresh)
  const setActiveLocal = useAppStore((state) => state.setActiveLocal)

  useEffect(() => {
    void refresh()
    return window.api.onActivePlayerChanged(setActiveLocal)
  }, [refresh, setActiveLocal])

  useEffect(() => {
    const socket = new WebSocket('ws://127.0.0.1:8765/ws')
    socket.addEventListener('message', (event) => {
      try {
        applyEvent(JSON.parse(String(event.data)) as ServerEvent)
      } catch {
        // ignore malformed frames
      }
    })
    return () => socket.close()
  }, [applyEvent])
}
