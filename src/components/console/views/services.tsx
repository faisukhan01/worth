'use client'

import { useState, Fragment } from 'react'
import { useServices } from '@/hooks/use-console-data'
import { StatusPill, SectionHeader, EmptyState, TONE_COLOR, statusTone } from '@/components/console/primitives'
import { Sparkline, UptimeRibbon } from '@/components/console/charts'
import { fmtNum, fmtPct, fmtMs } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

const LANG_COLOR: Record<string, string> = {
  go: 'var(--chart-1)',
  java: 'var(--chart-2)',
  python: 'var(--chart-4)',
  csharp: 'var(--chart-5)',
  c: 'var(--chart-3)',
}

export function ServicesView() {
  const { data, isLoading } = useServices()
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-14" />
        ))}
      </div>
    )
  }
  const services = (data?.services ?? []).filter(
    (s) => s.key.includes(filter.toLowerCase()) || s.name.toLowerCase().includes(filter.toLowerCase()),
  )
  if (!data) return <EmptyState title="Service catalog unavailable" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Services</h1>
          <p className="text-xs text-muted-foreground">
            {services.length} catalog entries · SLO-tracked · telemetry by ingest-gateway
          </p>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter services…"
            className="h-8 w-56 pl-8 text-xs"
            aria-label="filter services"
          />
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Service</th>
              <th className="hidden px-3 py-2.5 font-medium md:table-cell">Tier</th>
              <th className="px-3 py-2.5 text-right font-medium">Req/s</th>
              <th className="px-3 py-2.5 text-right font-medium">Error</th>
              <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">p99</th>
              <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Traffic · 30m</th>
              <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Uptime · 90d</th>
              <th className="px-3 py-2.5 text-right font-medium">SLO</th>
            </tr>
          </thead>
          <tbody>
            {services.map((s) => {
              const tone = statusTone(s.status)
              const isOpen = expanded === s.key
              return (
                <Fragment key={s.key}>
                  <tr
                    key={s.key}
                    className={cn(
                      'cursor-pointer border-b transition-colors last:border-0 hover:bg-accent/30',
                      isOpen && 'bg-accent/20',
                    )}
                    onClick={() => setExpanded(isOpen ? null : s.key)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                        <span className="h-6 w-1 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                        <div>
                          <div className="font-medium">{s.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">{s.key}</div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      <Badge variant="outline" className="rounded-sm text-[10px] capitalize">{s.tier}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{fmtNum(s.requestRate)}</td>
                    <td className="px-3 py-2.5 text-right tabular" style={{ color: s.errorRate >= 1 ? TONE_COLOR.warn : undefined }}>
                      {fmtPct(s.errorRate)}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular sm:table-cell">{fmtMs(s.p99)}</td>
                    <td className="hidden px-3 py-2.5 lg:table-cell">
                      <Sparkline values={s.spark} width={110} height={26} color={TONE_COLOR[tone]} />
                    </td>
                    <td className="hidden px-4 py-2.5 xl:table-cell">
                      <UptimeRibbon values={s.ribbon.slice(-60)} target={s.sloTarget} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span className="tabular text-muted-foreground">{s.sloTarget.toFixed(2)}%</span>
                        <StatusPill status={s.status} label="" className="px-1.5" />
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${s.key}-detail`} className="border-b bg-muted/10 last:border-0">
                      <td colSpan={8} className="px-10 py-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                          <Detail label="Owner team" value={s.owner} />
                          <Detail label="Language" value={s.language} color={LANG_COLOR[s.language]} />
                          <Detail label="30d uptime" value={`${s.uptime30.toFixed(3)}%`} />
                          <Detail label="p99 (30m avg)" value={fmtMs(s.p99Avg)} />
                          <Detail label="SLO target" value={`${s.sloTarget.toFixed(2)}%`} />
                          <Detail label="Error budget (30d)" value={`${Math.max(0, (100 - s.sloTarget) * 30 * 24).toFixed(1)} min`} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {services.length === 0 && <EmptyState title="No services match" hint={`filter: "${filter}"`} />}
      </div>

      <SectionHeader
        title="About SLO math"
        hint="uptime ribbon is a deterministic projection anchored to SLO + live error-rate regime"
      />
    </div>
  )
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium capitalize" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  )
}
