import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../lib/tauri'
import { failure } from '../lib/failure'
import type { GithubDeviceCode } from '../types'

export type DeviceFlowStatus = 'starting' | 'waiting' | 'expired' | 'denied' | 'error'

const SLOW_DOWN_STEP_SECONDS = 5

export function useGithubDeviceFlow(onAuthorized: () => void) {
  const [code, setCode] = useState<GithubDeviceCode | null>(null)
  const [expiresAt, setExpiresAt] = useState(0)
  const [status, setStatus] = useState<DeviceFlowStatus>('starting')
  const [error, setError] = useState('')
  const timer = useRef<number | undefined>(undefined)
  const run = useRef(0)
  const onDone = useRef(onAuthorized)
  useEffect(() => {
    onDone.current = onAuthorized
  })

  const stop = useCallback(() => {
    run.current += 1
    window.clearTimeout(timer.current)
  }, [])

  const start = useCallback(async () => {
    stop()
    const mine = run.current
    setStatus('starting')
    try {
      const next = await api.git.githubDeviceStart()
      if (mine !== run.current) return
      setCode(next)
      setExpiresAt(Date.now() + next.expiresIn * 1000)
      setStatus('waiting')

      const poll = async (seconds: number) => {
        timer.current = window.setTimeout(async () => {
          try {
            const outcome = await api.git.githubDevicePoll(next.deviceCode)
            if (mine !== run.current) return
            if (outcome === 'authorized') onDone.current()
            else if (outcome === 'expired') setStatus('expired')
            else if (outcome === 'denied') setStatus('denied')
            else void poll(outcome === 'slowDown' ? seconds + SLOW_DOWN_STEP_SECONDS : seconds)
          } catch (e) {
            if (mine !== run.current) return
            setError(failure('sign in to GitHub', e))
            setStatus('error')
          }
        }, seconds * 1000)
      }
      void poll(next.interval)
    } catch (e) {
      if (mine !== run.current) return
      setError(failure('start GitHub sign-in', e))
      setStatus('error')
    }
  }, [stop])

  useEffect(() => {
    void start()
    return stop
  }, [start, stop])

  return { code, expiresAt, status, error, restart: start }
}
