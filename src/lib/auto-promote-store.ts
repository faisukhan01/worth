'use client'

import { useSyncExternalStore } from 'react'

/**
 * Persisted AIOps auto-promotion preference.
 *
 * When enabled, the AIOps view promotes fresh CRITICAL anomalies into the
 * incident register automatically (rate-limited, dedup-aware). Stored in
 * localStorage under `lodestar.autopromote` via a tiny external store so the
 * setting survives reloads without setState-in-effect.
 */

const LS_KEY = 'lodestar.autopromote'
const listeners = new Set<() => void>()
let cache: boolean | null = null

function readValue(): boolean {
  if (cache !== null) return cache
  try {
    cache = localStorage.getItem(LS_KEY) === 'on'
  } catch {
    cache = false
  }
  return cache
}

function writeValue(next: boolean) {
  cache = next
  try {
    localStorage.setItem(LS_KEY, next ? 'on' : 'off')
  } catch {
    /* storage blocked - preference stays session-only */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  window.addEventListener('storage', l)
  return () => {
    listeners.delete(l)
    window.removeEventListener('storage', l)
  }
}

export function useAutoPromote(): [boolean, (next: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, readValue, () => false)
  return [enabled, writeValue]
}
