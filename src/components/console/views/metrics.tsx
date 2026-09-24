'use client'

import { useState } from 'react'
import { useMetrics } from '@/hooks/use-console-data'
import { AreaChart } from '@/components/console/charts'
import { SectionHeader, EmptyState } from '@/components/console/primitives'
import { fmtNum, fmtMs, fmtPct } from '@/lib/format'
import { useConsole, RANGES } from '@/store/console-store'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

const METRIC_OPTIONS = [
  { id: 'request.rate', label: 'Request rate', unit: '/s', fmt: fmtNum },
  { id: 'error.rate', label: 'Error rate', unit: '%', fmt: fmtPct },
  { id: 'latency.p50', label: 'p50 latency', unit: '', fmt: fmtMs },
  { id: 'latency.p95', label: 'p95 latency', unit: '', fmt: fmtMs },
  { id: 'latency.p99', label: 'p99 latency', unit: '', fmt: fmtMs },
  { id: 'cpu.usage', label: 'CPU usage', unit: '%', fmt: fmtPct },
  { id: 'mem.used', label: 'Memory', unit: '%', fmt: fmtPct },
  { id: 'net.rx.kbps', label: 'Net RX', unit: ' KB/s', fmt: fmtNum },
]

const SERIES_COLORS = ['var(--ok)', 'var(--warn)', 'var(--crit)', 'var(--chart-4)']

export function MetricsView() {
  const [selected, setSelected] = useState<string[]>(['latency.p99', 'error.rate'])
  const [service, setService] = useState('all')
  const [agentOnly, setAgentOnly] = useState(false)
  const { range, setRange } = useConsole()

  const names = selected.join(',')
  const { data, isLoading } = useMetrics(names, service === 'all' ? '' : service, agentOnly ? 'agent' : '')

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id].slice(-4)))

  // Aggregate per metric name across tag groups for the main chart: prefer
  // one series per metric (sum for rates, latest tags otherwise).
  const chartData = new Map<string, { ts: number; value: number }[]>()
  const stats = new Map<string, { latest: number; min: number; max: number; avg: number }>()
  for (const s of data?.series ?? []) {
    const bucket = chartData.get(s.name) ?? []
    s.points.forEach((p, i) => {
      const existing = bucket[i]
      bucket[i] = { ts: p.ts, value: (existing?.value ?? 0) + p.value }
    })
    chartData.set(s.name, bucket)
    const vals = s.points.map((p) => p.value)
    if (vals.length) {
      const prev = stats.get(s.name)
      const latest = vals[vals.length - 1]
      const avg = (vals.reduce((a, b) => a + b, 0)) / vals.length
      stats.set(s.name, {
        latest,
        min: Math.min(prev?.min ?? Infinity, ...vals),
        max: Math.max(prev?.max ?? -Infinity, ...vals),
        avg: Math.max(prev?.avg ?? 0, avg), // upper envelope across tag groups
      })
    }
  }

  const opt = (id: string) => METRIC_OPTIONS.find((m) => m.id === id)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Metrics explorer</h1>
          <p className="text-xs text-muted-foreground">
            query the live data plane · names → gateway ring buffers · {range} window
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border bg-card/60 px-2 py-1">
            <Switch id="agent-only" checked={agentOnly} onCheckedChange={setAgentOnly} className="scale-90" />
            <Label htmlFor="agent-only" className="text-[11px] text-muted-foreground">agent source only</Label>
          </div>
          <Select value={service} onValueChange={setService}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="service filter">
              <SelectValue placeholder="All services" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All services</SelectItem>
              {['api-gateway', 'checkout-service', 'auth-service', 'search-cluster', 'billing-worker', 'edge-cdn'].map((s) => (
                <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                  range === r ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric chips */}
      <div className="flex flex-wrap gap-1.5">
        {METRIC_OPTIONS.map((m) => {
          const active = selected.includes(m.id)
          return (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-1 text-[11px] font-medium transition-all',
                active
                  ? 'border-transparent text-primary-foreground'
                  : 'bg-card/50 text-muted-foreground hover:border-ring/50 hover:text-foreground',
              )}
              style={active ? { background: SERIES_COLORS[selected.indexOf(m.id) % 4] } : undefined}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      {/* Chart */}
      <div className="card-surface">
        <SectionHeader
          title={selected.map((s) => opt(s)?.label ?? s).join(' · ') || 'no metric selected'}
          hint={service === 'all' ? 'all services' : service}
          right={<span className="text-[10px] text-muted-foreground">{data?.series?.length ?? 0} raw series aggregated</span>}
        />
        <div className="px-2 pb-3">
          {isLoading && !data ? (
            <Skeleton className="mx-2 h-[220px]" />
          ) : selected.length === 0 ? (
            <EmptyState title="Select up to four metrics" hint="chips above build the query" />
          ) : (
            <AreaChart data={chartData.get(selected[0]) ?? []} height={230} color={SERIES_COLORS[0]} unit={opt(selected[0])?.unit ?? ''} />
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {selected.map((id, idx) => {
          const st = stats.get(id)
          const o = opt(id)
          return (
            <div key={id} className="card-surface p-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: SERIES_COLORS[idx % 4] }} />
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{o?.label}</span>
              </div>
              <div className="mt-2 text-xl font-semibold tabular">
                {o?.fmt(st?.latest ?? NaN)}
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">now</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] tabular text-muted-foreground">
                <div>
                  <div className="font-medium text-foreground/70">{o?.fmt(st?.min ?? NaN)}</div>min
                </div>
                <div>
                  <div className="font-medium text-foreground/70">{o?.fmt(st?.avg ?? NaN)}</div>avg
                </div>
                <div>
                  <div className="font-medium text-foreground/70">{o?.fmt(st?.max ?? NaN)}</div>max
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
