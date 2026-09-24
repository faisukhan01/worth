'use client'

import { create } from 'zustand'

export type ViewKey =
  | 'overview'
  | 'services'
  | 'metrics'
  | 'logs'
  | 'alerts'
  | 'aiops'
  | 'billing'
  | 'reports'
  | 'settings'
  | 'admin'

export const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'overview', label: 'Overview', hint: 'Platform heartbeat' },
  { key: 'services', label: 'Services', hint: 'Catalog & SLOs' },
  { key: 'metrics', label: 'Metrics', hint: 'Explorer' },
  { key: 'logs', label: 'Logs', hint: 'Live tail' },
  { key: 'alerts', label: 'Alerts', hint: 'Rules & incidents' },
  { key: 'aiops', label: 'AIOps', hint: 'Anomalies & forecasts' },
  { key: 'billing', label: 'Usage', hint: 'Metering & plan' },
  { key: 'reports', label: 'Reports', hint: 'SLA & exports' },
  { key: 'settings', label: 'Settings', hint: 'Keys, team, org' },
]

export const RANGES = ['15m', '30m', '1h', '6h', '24h'] as const
export type RangeKey = (typeof RANGES)[number]

interface ConsoleState {
  view: ViewKey
  range: RangeKey
  logLevel: string
  logService: string
  logQuery: string
  paused: boolean
  setView: (v: ViewKey) => void
  setRange: (r: RangeKey) => void
  setLogFilter: (patch: { level?: string; service?: string; query?: string }) => void
  togglePaused: () => void
}

export const useConsole = create<ConsoleState>((set) => ({
  view: 'overview',
  range: '30m',
  logLevel: '',
  logService: '',
  logQuery: '',
  paused: false,
  setView: (view) => set({ view }),
  setRange: (range) => set({ range }),
  setLogFilter: (patch) =>
    set((s) => ({
      logLevel: patch.level ?? s.logLevel,
      logService: patch.service ?? s.logService,
      logQuery: patch.query ?? s.logQuery,
    })),
  togglePaused: () => set((s) => ({ paused: !s.paused })),
}))
