'use client'

import { useOverview } from '@/hooks/use-console-data'
import { RANGES, useConsole } from '@/store/console-store'
import { KpiTile, StatusPill, LiveDot, SectionHeader, EmptyState, TONE_COLOR, statusTone } from '@/components/console/primitives'
import { Sparkline, AreaChart, UptimeRibbon } from '@/components/console/charts'
import { fmtNum, fmtPct, fmtMs, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertTriangle, ArrowUpRight, Cpu, MemoryStick, Radio, ServerCrash } from 'lucide-react'

export function OverviewView() {
  const { data, isLoading } = useOverview()
  const { range, setRange, setView } = useConsole()

  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[86px]" />
          ))}
        </div>
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[220px]" />
      </div>
    )
  }
  if (!data) return <EmptyState title="Overview unavailable" hint="the aggregation API did not respond" />

  const { kpis, traffic, services, host, insights, incidents } = data
  const overallTone = kpis.overallStatus === 'healthy' ? 'ok' : kpis.overallStatus === 'degraded' ? 'warn' : 'crit'

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            Platform overview
            <LiveDot tone={overallTone as 'ok' | 'warn' | 'crit'} />
          </h1>
          <p className="text-xs text-muted-foreground">
            {kpis.engineWarm ? 'AIOps engine warm · ' : 'engine warming · '}
            {kpis.metricsIngested > 0 ? `${fmtNum(kpis.metricsIngested)} samples ingested` : 'awaiting ingest'}
            {' · '}updated {timeAgo(data.meta.at)}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border bg-card/60 p-0.5" role="tablist" aria-label="time range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
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

      {/* KPI band */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <KpiTile
          label="Request rate"
          value={fmtNum(kpis.totalRps)}
          sub="req/s across fleet"
          tone="neutral"
          spark={<Sparkline values={traffic.map((t) => t.value)} width={92} />}
        />
        <KpiTile
          label="Error rate"
          value={fmtPct(kpis.errorRate)}
          sub="weighted avg"
          tone={kpis.errorRate >= 2 ? 'crit' : kpis.errorRate >= 1 ? 'warn' : 'ok'}
          spark={<Sparkline values={services.map((s) => s.errorRate)} width={92} color={TONE_COLOR.warn} />}
        />
        <KpiTile
          label="p99 latency"
          value={fmtMs(kpis.p99)}
          sub="fleet weighted"
          tone={kpis.p99 > 300 ? 'crit' : kpis.p99 > 150 ? 'warn' : 'ok'}
        />
        <KpiTile
          label="Active incidents"
          value={String(kpis.openIncidents)}
          sub={`${kpis.alertRules} rules armed`}
          tone={kpis.openIncidents > 0 ? 'warn' : 'ok'}
        />
        <KpiTile
          label="Live series"
          value={fmtNum(kpis.activeSeries)}
          sub={`${kpis.agents} agent${kpis.agents === 1 ? '' : 's'} connected`}
          tone="neutral"
        />
        <KpiTile
          label="AIOps verdict"
          value={kpis.overallStatus === 'healthy' ? 'Nominal' : kpis.overallStatus === 'degraded' ? 'Degraded' : 'Critical'}
          sub={insights?.anomalies.length ? `${insights.anomalies.length} open anomalies` : 'no anomalies open'}
          tone={overallTone as 'ok' | 'warn' | 'crit'}
        />
      </div>

      {/* Traffic + host */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card-surface lg:col-span-2">
          <SectionHeader
            title="Fleet request rate"
            hint={`last ${range} · all services`}
            right={<span className="text-[11px] tabular text-muted-foreground">peak {fmtNum(Math.max(...traffic.map((t) => t.value), 0))}/s</span>}
          />
          <div className="px-2 pb-3">
            <AreaChart data={traffic} height={190} unit="/s" />
          </div>
        </div>

        <div className="card-surface">
          <SectionHeader
            title="Host telemetry"
            hint={host.source === 'agent' ? 'live via pulseagent (C)' : 'simulated (agent offline)'}
            right={
              <span className="flex items-center gap-1 rounded border bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                <Radio className="h-2.5 w-2.5" /> /proc
              </span>
            }
          />
          <div className="space-y-3 px-4 pb-4 pt-1">
            <HostMetric
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="CPU"
              value={host.cpuNow}
              unit="%"
              values={host.cpu}
              tone={host.cpuNow > 85 ? 'crit' : host.cpuNow > 60 ? 'warn' : 'ok'}
            />
            <HostMetric
              icon={<MemoryStick className="h-3.5 w-3.5" />}
              label="Memory"
              value={host.memNow}
              unit="%"
              values={host.mem}
              tone={host.memNow > 90 ? 'crit' : host.memNow > 75 ? 'warn' : 'ok'}
            />
            <div className="rounded-lg border bg-card/40 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" /> 30-day uptime
              </div>
              <UptimeRibbon values={Array.from({ length: 30 }, (_, i) => 99.9 + ((i * 7) % 10) / 100)} target={99.9} />
              <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                <span>90d ago</span>
                <span className="tabular text-foreground/70">99.94%</span>
                <span>today</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Services grid + AIOps/incidents rail */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card-surface lg:col-span-2">
          <SectionHeader
            title="Service health"
            hint="live per-service signal"
            right={
              <button onClick={() => setView('services')} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                all services <ArrowUpRight className="h-3 w-3" />
              </button>
            }
          />
          <div className="grid grid-cols-1 gap-2 px-4 pb-4 sm:grid-cols-2">
            {services.map((s) => {
              const tone = s.errorRate >= 3 ? 'crit' : s.errorRate >= 1 ? 'warn' : 'ok'
              return (
                <button
                  key={s.key}
                  onClick={() => setView('services')}
                  className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5 text-left transition-colors hover:border-ring/60 hover:bg-accent/30"
                >
                  <span className="h-8 w-1 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[12px] font-medium">{s.key}</div>
                    <div className="flex gap-3 text-[10px] tabular text-muted-foreground">
                      <span>{fmtNum(s.requestRate)}/s</span>
                      <span style={{ color: TONE_COLOR[tone] }}>{fmtPct(s.errorRate)}</span>
                      <span>p99 {fmtMs(s.p99)}</span>
                    </div>
                  </div>
                  <Sparkline values={s.spark} width={70} height={24} color={TONE_COLOR[tone]} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-3">
          {/* AIOps insight */}
          <div className="card-surface">
            <SectionHeader
              title="AIOps insights"
              right={
                <button onClick={() => setView('aiops')} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                  engine <ArrowUpRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="space-y-2 px-4 pb-4">
              {insights?.anomalies?.length ? (
                insights.anomalies.slice(0, 3).map((a) => (
                  <div key={a.id} className="rounded-lg border border-warn/20 bg-warn/5 p-2.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <AlertTriangle className="h-3 w-3" style={{ color: TONE_COLOR.warn }} />
                      <span className="font-mono">{a.service}</span>
                      <span className="text-muted-foreground">· {a.metric}</span>
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{a.message}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-ok/20 bg-ok/5 p-3 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">No anomalies detected.</span> The engine is tracking{' '}
                  {services.length} services against rolling baselines.
                </div>
              )}
            </div>
          </div>

          {/* Open incidents */}
          <div className="card-surface">
            <SectionHeader
              title="Incidents"
              right={
                <button onClick={() => setView('alerts')} className="flex items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                  register <ArrowUpRight className="h-3 w-3" />
                </button>
              }
            />
            <div className="space-y-2 px-4 pb-4">
              {incidents.length ? (
                incidents.slice(0, 3).map((i) => (
                  <div key={i.id} className="flex items-start gap-2.5 rounded-lg border bg-card/40 p-2.5">
                    <ServerCrash className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TONE_COLOR[statusTone(i.severity)] }} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium">{i.title}</div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{i.serviceKey}</span>·
                        <StatusPill status={i.status} />
                        <span>{timeAgo(i.startedAt)}</span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState title="No open incidents" hint="the on-call queue is clear" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function HostMetric({
  icon,
  label,
  value,
  unit,
  values,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  unit: string
  values: number[]
  tone: 'ok' | 'warn' | 'crit'
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-md border bg-card/60 text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium">{label}</span>
          <span className="text-[12px] font-semibold tabular">
            {value.toFixed(1)}
            <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{unit}</span>
          </span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, value)}%`, background: TONE_COLOR[tone] }} />
        </div>
      </div>
      <Sparkline values={values} width={64} height={22} color={TONE_COLOR[tone]} filled={false} />
    </div>
  )
}
