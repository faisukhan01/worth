'use client'

import { useSyncExternalStore } from 'react'

/**
 * Saved incident-filter presets for the Alerts view.
 *
 * Stored in localStorage under `lodestar.incident-filters` via a tiny
 * external store (same idiom as the log saved searches) so presets survive
 * reloads without setState-in-effect.
 */

export interface IncidentFilterPreset {
  id: string
  label: string
  status: string
  severity: string
  service: string
  assignee: string
}

const LS_KEY = 'lodestar.incident-filters'
const listeners = new Set<() => void>()
let cache: IncidentFilterPreset[] | null = null
const EMPTY: IncidentFilterPreset[] = []

function readPresets(): IncidentFilterPreset[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    cache = Array.isArray(parsed) ? (parsed as IncidentFilterPreset[]).slice(0, 12) : []
  } catch {
    cache = []
  }
  return cache
}

function writePresets(next: IncidentFilterPreset[]) {
  cache = next
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked - presets stay session-only */
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

export function useIncidentFilterPresets(): [IncidentFilterPreset[], (p: IncidentFilterPreset) => void, (id: string) => void] {
  const presets = useSyncExternalStore(subscribe, readPresets, () => EMPTY)
  const save = (preset: IncidentFilterPreset) => {
    writePresets([preset, ...readPresets().filter((p) => p.label !== preset.label)].slice(0, 12))
  }
  const remove = (id: string) => {
    writePresets(readPresets().filter((p) => p.id !== id))
  }
  return [presets, save, remove]
}
