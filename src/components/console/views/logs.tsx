'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useLogs } from '@/hooks/use-console-data'
import { EmptyState } from '@/components/console/primitives'
import { fmtClock } from '@/lib/format'
import { useConsole } from '@/store/console-store'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { Pause, Play, Terminal, Pin, X, Radio } from 'lucide-react'

const LEVELS = ['', 'debug', 'info', 'warn', 'error', 'fatal']
const SERVICES = ['', 'api-gateway', 'checkout-service', 'auth-service', 'search-cluster', 'billing-worker', 'edge-cdn']

// ---- saved searches (pinned filter presets, persisted in localStorage) ------

interface SavedSearch {
  id: string
  label: string
  level: string
  service: string
  query: string
}

const LS_KEY = 'lodestar.saved-searches.v1'

// Tiny external store so the chips survive reloads without setState-in-effect.
let savedCache: SavedSearch[] | null = null
const savedListeners = new Set<() => void>()
const SAVED_EMPTY: SavedSearch[] = []

function readSaved(): SavedSearch[] {
  if (savedCache) return savedCache
  try {
    const raw = localStorage.getItem(LS_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    savedCache = Array.isArray(parsed) ? (parsed as SavedSearch[]).slice(0, 12) : []
  } catch {
    savedCache = []
  }
  return savedCache
}

function writeSaved(next: SavedSearch[]) {
  savedCache = next
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next))
  } catch {
    /* storage full/blocked - chips stay session-only */
  }
  savedListeners.forEach((l) => l())
}

function subscribeSaved(l: () => void) {
  savedListeners.add(l)
  window.addEventListener('storage', l)
  return () => {
    savedListeners.delete(l)
    window.removeEventListener('storage', l)
  }
}

function useSavedSearches() {
  const saved = useSyncExternalStore(subscribeSaved, readSaved, () => SAVED_EMPTY)
  return {
    saved,
    save: (s: Omit<SavedSearch, 'id'>) =>
      writeSaved([...readSaved().filter((x) => x.label !== s.label), { ...s, id: crypto.randomUUID() }]),
    remove: (id: string) => writeSaved(readSaved().filter((x) => x.id !== id)),
  }
}

const LEVEL_STYLE: Record<string, { color: string; chip: string }> = {
  debug: { color: 'var(--muted-foreground)', chip: 'bg-muted text-muted-foreground' },
  info: { color: 'var(--ok)', chip: 'bg-ok/10 text-ok' },
  warn: { color: 'var(--warn)', chip: 'bg-warn/10 text-warn' },
  error: { color: 'var(--crit)', chip: 'bg-crit/10 text-crit' },
  fatal: { color: 'var(--crit)', chip: 'bg-crit/20 text-crit font-semibold' },
  trace: { color: 'var(--muted-foreground)', chip: 'bg-muted text-muted-foreground' },
}

// ---- SSE live tail -----------------------------------------------------------

type ConnState = 'off' | 'connecting' | 'live' | 'error'

interface LiveRow {
  level: string
  service: string
  message: string
  ts: number
}

interface BeatStats {
  agents: number
  rps: number
  series_active: number
  ts: number
}

/** Stable identity for dedupe against the polled ring buffer. */
const logKey = (l: { ts: number; service: string; message: string }) => `${l.ts}|${l.service}|${l.message}`

export function LogsView() {
  const { data, isLoading } = useLogs()
  const { logLevel, logService, logQuery, paused, setLogFilter, togglePaused } = useConsole()
  const { saved, save, remove } = useSavedSearches()
  const scrollRef = useRef<HTMLDivElement>(null)

  // SSE live tail state - rows arrive over /api/logs/stream (gateway fan-out)
  const [live, setLive] = useState(false)
  const [conn, setConn] = useState<ConnState>('off')
  const [liveRows, setLiveRows] = useState<LiveRow[]>([])
  const [beat, setBeat] = useState<BeatStats | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const errorToastRef = useRef(false)

  // Filters read through a ref inside SSE callbacks so the listeners never go stale
  const filtersRef = useRef({ level: logLevel, service: logService, query: logQuery })
  useEffect(() => {
    filtersRef.current = { level: logLevel, service: logService, query: logQuery }
  }, [logLevel, logService, logQuery])

  const stopLive = (silent = false) => {
    esRef.current?.close()
    esRef.current = null
    setConn('off')
    setLive(false)
    setLiveRows([]) // poller re-renders the buffer within one tick
    setBeat(null)
    if (!silent) toast.info('Live tail off', { description: 'Back to the 5s ring-buffer tail.' })
  }

  const startLive = () => {
    if (esRef.current) return
    errorToastRef.current = false
    setConn('connecting')
    const es = new EventSource('/api/logs/stream')
    esRef.current = es

    es.addEventListener('open', () => {
      setConn('live')
    })
    es.addEventListener('log', (ev) => {
      setConn('live')
      try {
        const parsed = JSON.parse((ev as MessageEvent).data as string) as { type?: string; data?: LiveRow }
        const row = parsed?.data
        if (parsed?.type !== 'log' || !row || typeof row.ts !== 'number') return
        const f = filtersRef.current
        if (f.level && row.level !== f.level) return
        if (f.service && row.service !== f.service) return
        if (f.query && !row.message.toLowerCase().includes(f.query.toLowerCase())) return
        setLiveRows((prev) => [row, ...prev].slice(0, 150))
      } catch {
        /* malformed frame - skip */
      }
    })
    es.addEventListener('heartbeat', (ev) => {
      try {
        const parsed = JSON.parse((ev as MessageEvent).data as string) as {
          ts?: number
          stats?: { agents?: number; rps?: number; series_active?: number }
        }
        if (parsed?.stats) {
          setBeat({
            agents: parsed.stats.agents ?? 0,
            rps: parsed.stats.rps ?? 0,
            series_active: parsed.stats.series_active ?? 0,
            ts: parsed.ts ?? Date.now(),
          })
        }
      } catch {
        /* ignore */
      }
    })
    es.addEventListener('error', () => {
      if (es.readyState === EventSource.CLOSED) {
        setConn('error')
        if (!errorToastRef.current) {
          errorToastRef.current = true
          toast.error('Live tail disconnected', { description: 'The gateway stream closed. Polling continues every 5s.' })
        }
      } else {
        // EventSource auto-reconnects; surface the retry state
        setConn('connecting')
      }
    })
    setLive(true)
  }

  const toggleLive = () => (live || esRef.current ? stopLive() : startLive())

  // Close the stream when the view unmounts
  useEffect(() => () => { esRef.current?.close(); esRef.current = null }, [])

  // Auto-follow tail unless paused
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = 0 // newest-first feed
    }
  }, [data, paused, liveRows])

  const logs = data?.logs ?? []
  const filtersActive = !!(logLevel || logService || logQuery)

  // Live rows must also match the CURRENT filters at render time: rows that
  // arrived under an earlier filter would otherwise linger forever, since a
  // differently-filtered poller can never absorb them.
  const matchesFilters = (l: LiveRow) =>
    (!logLevel || l.level === logLevel) &&
    (!logService || l.service === logService) &&
    (!logQuery || l.message.toLowerCase().includes(logQuery.toLowerCase()))

  // Merge live rows above the buffer, dropping ones the poller has absorbed
  const polledKeys = new Set(logs.map(logKey))
  const freshLive = liveRows.filter((r) => !polledKeys.has(logKey(r)) && matchesFilters(r))
  const merged: (LiveRow & { fresh?: boolean })[] = [...freshLive.map((r) => ({ ...r, fresh: true })), ...logs]

  const pinCurrent = () => {
    const label = describeFilter(logLevel, logService, logQuery)
    save({ label, level: logLevel, service: logService, query: logQuery })
    toast.success('Search pinned', { description: label })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <Terminal className="h-4 w-4 text-primary" />
            Live logs
          </h1>
          <p className="text-xs text-muted-foreground">
            ring buffer tail · {data?.total ?? 0} buffered · source: {data?.source ?? '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Input
              value={logQuery}
              onChange={(e) => setLogFilter({ query: e.target.value })}
              placeholder="grep…"
              className="h-8 w-40 font-mono text-xs"
              aria-label="grep logs"
            />
          </div>
          <Select value={logService || 'all'} onValueChange={(v) => setLogFilter({ service: v === 'all' ? '' : v })}>
            <SelectTrigger className="h-8 w-40 font-mono text-xs" aria-label="service filter">
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              {SERVICES.map((s) => (
                <SelectItem key={s || 'all'} value={s || 'all'} className="font-mono text-xs">
                  {s || 'All services'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={logLevel || 'any'} onValueChange={(v) => setLogFilter({ level: v === 'any' ? '' : v })}>
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="level filter">
              <SelectValue placeholder="Level" />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l || 'any'} value={l || 'any'} className="text-xs capitalize">
                  {l || 'Any level'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={pinCurrent}
            disabled={!filtersActive}
            title={filtersActive ? 'Pin this filter combination' : 'Set a filter first'}
          >
            <Pin className="h-3 w-3" />
            Pin
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-8 gap-1.5 text-xs transition-colors',
              conn === 'live' && 'border-ok/40 text-ok hover:text-ok',
              conn === 'connecting' && 'border-warn/40 text-warn hover:text-warn',
            )}
            onClick={toggleLive}
            title={conn === 'off' || conn === 'error' ? 'Stream new log entries over SSE (gateway fan-out)' : 'Disconnect the live stream'}
            aria-pressed={live}
          >
            <Radio className={cn('h-3 w-3', conn === 'connecting' && 'animate-pulse')} />
            Live tail
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={togglePaused}>
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      {/* saved searches chips */}
      {saved.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="saved searches">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Pin className="h-2.5 w-2.5" />
            pinned
          </span>
          {saved.map((s) => {
            const active = s.level === logLevel && s.service === logService && s.query === logQuery
            return (
              <span
                key={s.id}
                className={cn(
                  'group inline-flex h-7 items-center gap-1 rounded-full border pl-2.5 pr-1 text-[11px] transition-colors',
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'bg-card/60 text-muted-foreground hover:border-ring/50 hover:text-foreground',
                )}
              >
                <button
                  onClick={() =>
                    setLogFilter({ level: s.level, service: s.service, query: s.query })
                  }
                  className="max-w-56 truncate font-mono"
                  title={`${s.label} — apply`}
                >
                  {s.label}
                </button>
                <button
                  onClick={() => remove(s.id)}
                  aria-label={`remove saved search ${s.label}`}
                  className="rounded-full p-0.5 opacity-40 transition-opacity hover:bg-accent hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <div className="card-surface overflow-hidden">
        <div
          ref={scrollRef}
          className="scroll-thin max-h-[calc(100vh-300px)] min-h-[420px] overflow-y-auto font-mono text-[11.5px] leading-relaxed"
          role="log"
          aria-live={paused ? 'off' : 'polite'}
          aria-label="log stream"
        >
          {isLoading && !logs.length && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${60 + ((i * 13) % 40)}%` }} />
              ))}
            </div>
          )}
          {merged.map((l) => {
            const style = LEVEL_STYLE[l.level] ?? LEVEL_STYLE.info
            return (
              <div
                key={logKey(l)}
                className={cn(
                  'log-row flex items-start gap-3 border-b border-border/40 px-4 py-1.5 last:border-0',
                  (l.level === 'error' || l.level === 'fatal') && 'bg-crit/5',
                  l.fresh && 'rise-in border-l-2 border-l-primary/60',
                )}
              >
                <span className="shrink-0 tabular text-muted-foreground">{fmtClock(l.ts)}</span>
                <span className={cn('w-11 shrink-0 rounded-sm px-1 text-center text-[10px] uppercase', style.chip)}>
                  {l.level}
                </span>
                <span className="w-32 shrink-0 truncate text-primary/90">{l.service}</span>
                <span className="min-w-0 flex-1 break-words text-foreground/85">{l.message}</span>
                {l.fresh && (
                  <span className="shrink-0 rounded-sm bg-primary/10 px-1 text-[9px] uppercase tracking-wider text-primary" aria-label="arrived over live stream">
                    live
                  </span>
                )}
              </div>
            )
          })}
          {!isLoading && merged.length === 0 && (
            <EmptyState title="No entries match the filters" hint="widen the level/service or clear grep" />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
        {conn === 'live' ? (
          <span className="flex items-center gap-1.5 text-ok">
            <span className="live-dot bg-ok" />
            SSE live · agents {beat?.agents ?? '—'} · {beat ? beat.rps.toFixed(0) : '—'} rps · {beat?.series_active ?? '—'} series
          </span>
        ) : conn === 'connecting' ? (
          <span className="flex items-center gap-1.5 text-warn">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-warn" />
            connecting to gateway stream…
          </span>
        ) : conn === 'error' ? (
          <span className="flex items-center gap-1.5 text-crit">
            <span className="h-1.5 w-1.5 rounded-full bg-crit" />
            live tail disconnected
          </span>
        ) : (
          <span className={cn('flex items-center gap-1.5', paused && 'text-warn')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', paused ? 'bg-warn' : 'live-dot bg-ok')} />
            {paused ? 'stream paused' : 'tailing every 5s'}
          </span>
        )}
        <span>newest first · {merged.length} shown{freshLive.length > 0 && ` · ${freshLive.length} fresh`}</span>
        <LevelDistribution logs={merged} />
        <span className="ml-auto">retention: 8000 entries ring buffer</span>
      </div>
    </div>
  )
}

function LevelDistribution({ logs }: { logs: { level: string }[] }) {
  const order: { key: string; color: string }[] = [
    { key: 'debug', color: 'var(--muted-foreground)' },
    { key: 'info', color: 'var(--ok)' },
    { key: 'warn', color: 'var(--warn)' },
    { key: 'error', color: 'var(--crit)' },
    { key: 'fatal', color: 'var(--crit)' },
  ]
  const counts = new Map<string, number>()
  for (const l of logs) counts.set(l.level, (counts.get(l.level) ?? 0) + 1)
  const total = logs.length || 1

  return (
    <span className="hidden items-center gap-2 md:flex" title="level distribution of the current view">
      <span className="flex h-1.5 w-32 overflow-hidden rounded-full bg-muted">
        {order.map(({ key, color }) => {
          const n = (counts.get(key) ?? 0) / total
          return n > 0 ? (
            <span
              key={key}
              className="h-full transition-all"
              style={{ width: `${n * 100}%`, background: color, opacity: key === 'fatal' ? 1 : 0.85 }}
            />
          ) : null
        })}
      </span>
      <span className="tabular">
        {order
          .filter(({ key }) => (counts.get(key) ?? 0) > 0)
          .map(({ key }) => `${counts.get(key)} ${key}`)
          .join(' · ')}
      </span>
    </span>
  )
}

/** Human label for a pinned filter, e.g. "error × checkout × timeout". */
function describeFilter(level: string, service: string, query: string): string {
  return [level, service, query].filter(Boolean).join(' × ') || 'all entries'
}
