'use client'

import { useEffect, useRef, useState } from 'react'
import { useAiops, useAlerts, usePromoteIncident, useIncidentAction } from '@/hooks/use-console-data'
import { StatusPill, EmptyState, TONE_COLOR, SectionHeader, statusTone } from '@/components/console/primitives'
import { AreaChart, ConfidenceBar } from '@/components/console/charts'
import { fmtNum, timeAgo, fmtClock } from '@/lib/format'
import { useAutoPromote } from '@/lib/auto-promote-store'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { BrainCircuit, Check, LineChart as LineChartIcon, Stethoscope, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OpenIncident } from '@/hooks/use-console-data'

const FORECAST_COLOR = 'var(--chart-4)'
// Auto-promotion guard rails: only CRITICAL active anomalies are promoted, at
// most one per cooldown window, so a detection storm cannot flood the register.
const AUTO_PROMOTE_COOLDOWN_MS = 90_000
const AUTO_PROMOTE_POLL_MS = 30_000

function AutoPromoteToggle() {
  const [enabled, setEnabled] = useAutoPromote()
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
      <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Auto-promote critical anomalies" className="scale-75" />
      auto-promote critical
    </label>
  )
}

export function AiopsView() {
  const { data, isLoading } = useAiops()
  const { data: alertsData } = useAlerts() // open incidents seed the promoted state
  const promote = usePromoteIncident()
  const action = useIncidentAction()
  const [forecastIdx, setForecastIdx] = useState(0)
  const [promoted, setPromoted] = useState<Set<string>>(new Set())
  const [autoPromote] = useAutoPromote()

  // Stable key per (service, metric) — survives anomaly-id rotation between polls.
  const keyOf = (service: string, metric: string) => `${service}:${metric}`
  const openByDedupKey = new Map<string, OpenIncident>()
  for (const i of alertsData?.incidents ?? []) {
    if (i.status !== 'resolved' && i.dedupKey && !openByDedupKey.has(i.dedupKey)) {
      openByDedupKey.set(i.dedupKey, i)
    }
  }

  // Auto-promotion loop. Reads anomalies/open-incidents through refs so the
  // interval is not re-armed on every poll; only critical + active anomalies
  // that are not yet tracked are eligible, max one per cooldown.
  const anomaliesRef = useRef(data?.anomalies)
  const openRef = useRef(openByDedupKey)
  const promotedRef = useRef(promoted)
  const lastAutoAt = useRef(0)
  useEffect(() => {
    anomaliesRef.current = data?.anomalies
    openRef.current = openByDedupKey
    promotedRef.current = promoted
  })
  useEffect(() => {
    if (!autoPromote) return
    const tick = () => {
      if (Date.now() - lastAutoAt.current < AUTO_PROMOTE_COOLDOWN_MS) return
      const open = openRef.current
      const eligible = (anomaliesRef.current ?? []).find(
        (a) => a.severity === 'critical' && a.active !== false &&
          !open.has(`${a.service}:${a.metric}`) && !promotedRef.current.has(`${a.service}:${a.metric}`),
      )
      if (!eligible) return
      lastAutoAt.current = Date.now()
      promote
        .mutateAsync({
          service: eligible.service,
          metric: eligible.metric,
          severity: eligible.severity,
          message: eligible.message,
          baseline: eligible.baseline,
          observed: eligible.observed,
        })
        .then((r) => {
          if (!r.deduplicated) {
            toast.info('Auto-promoted critical anomaly', {
              description: `${eligible.metric} on ${eligible.service} joined the incident register.`,
            })
          }
        })
        .catch(() => {
          // promotion failed - next cooldown will retry
        })
    }
    const t = setInterval(tick, AUTO_PROMOTE_POLL_MS)
    return () => clearInterval(t)
  }, [autoPromote])

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-36" />
        <Skeleton className="h-72" />
      </div>
    )
  }
  if (!data || !data.summary) return <EmptyState title="AIOps engine unreachable" hint="python plane on :3200 did not answer" />

  const { anomalies, forecasts, health, summary } = data
  const overallTone = summary.overall_status === 'healthy' ? 'ok' : summary.overall_status === 'degraded' ? 'warn' : 'crit'
  const fc = forecasts[forecastIdx]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BrainCircuit className="h-5 w-5 text-primary" />
            AIOps engine
          </h1>
          <p className="text-xs text-muted-foreground">
            EWMA + robust z-score baselining · damped Holt forecasts · engine uptime {Math.floor(summary.uptime_seconds / 60)}m
          </p>
        </div>
        <div
          className="flex items-center gap-2.5 rounded-xl border px-4 py-2"
          style={{
            borderColor: `color-mix(in oklch, ${TONE_COLOR[overallTone]} 40%, transparent)`,
            background: `color-mix(in oklch, ${TONE_COLOR[overallTone]} 8%, transparent)`,
          }}
        >
          <Stethoscope className="h-4 w-4" style={{ color: TONE_COLOR[overallTone] }} />
          <div>
            <div className="text-[13px] font-semibold capitalize" style={{ color: TONE_COLOR[overallTone] }}>
              {summary.overall_status}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {summary.services_monitored} services · {summary.open_anomalies} open anomalies
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-5">
        {/* Anomalies */}
        <div className="card-surface lg:col-span-2">
          <SectionHeader title="Anomaly feed" hint="explainable · baseline vs observed" right={<AutoPromoteToggle />} />
          <div className="scroll-thin max-h-[520px] space-y-2 overflow-y-auto px-4 pb-4">
            {anomalies.length ? (
              anomalies.map((a) => (
                <div key={a.id} className="rounded-lg border bg-card/40 p-3" style={{ borderColor: `color-mix(in oklch, ${TONE_COLOR[statusTone(a.severity)]} 30%, transparent)` }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium">
                      <Zap className="h-3 w-3" style={{ color: TONE_COLOR[statusTone(a.severity)] }} />
                      <span className="font-mono text-[11px]">{a.service}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-mono text-[11px]">{a.metric}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {a.active === false && (
                        <span className="rounded border bg-muted/40 px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground">
                          recent
                        </span>
                      )}
                      <StatusPill status={a.severity} />
                    </div>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{a.message}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <ConfidenceBar value={a.confidence} />
                    <span className="text-[10px] tabular text-muted-foreground">{timeAgo(a.startedAt)}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 rounded-md border bg-muted/20 p-2 text-center text-[10px] tabular">
                    <div>
                      <div className="font-medium">{fmtNum(a.baseline, 1)}</div>
                      <div className="text-muted-foreground">baseline</div>
                    </div>
                    <div>
                      <div className="font-medium" style={{ color: TONE_COLOR[statusTone(a.severity)] }}>{fmtNum(a.observed, 1)}</div>
                      <div className="text-muted-foreground">observed</div>
                    </div>
                    <div>
                      <div className="font-medium">{a.score.toFixed(1)}σ</div>
                      <div className="text-muted-foreground">deviation</div>
                    </div>
                  </div>
                  {(() => {
                    const tracked = openByDedupKey.get(keyOf(a.service, a.metric))
                    if (tracked) {
                      return (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-ok/25 bg-ok/5 px-2.5 py-1.5">
                          <StatusPill status={tracked.status} />
                          <span className="text-[10px] text-muted-foreground">in register</span>
                          <div className="ml-auto flex gap-1">
                            {tracked.status === 'triggered' && (
                              <button
                                className="flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-medium transition-colors disabled:opacity-50"
                                style={{ color: TONE_COLOR.warn, borderColor: `color-mix(in oklch, ${TONE_COLOR.warn} 35%, transparent)` }}
                                disabled={action.isPending}
                                onClick={() =>
                                  action.mutate(
                                    { id: tracked.id, action: 'acknowledge' },
                                    {
                                      onSuccess: () => toast.success('Incident acknowledged', { description: `${a.metric} on ${a.service} · on-call notified` }),
                                      onError: (e: Error) => toast.error('Transition rejected', { description: e.message }),
                                    },
                                  )
                                }
                              >
                                <Check className="h-2.5 w-2.5" /> ack
                              </button>
                            )}
                            <button
                              className="flex h-6 items-center gap-1 rounded border px-2 text-[10px] font-medium transition-colors hover:bg-ok/15 disabled:opacity-50"
                              style={{ color: TONE_COLOR.ok, borderColor: `color-mix(in oklch, ${TONE_COLOR.ok} 35%, transparent)` }}
                              disabled={action.isPending}
                              onClick={() =>
                                action.mutate(
                                  { id: tracked.id, action: 'resolve' },
                                  {
                                    onSuccess: () => toast.success('Incident resolved', { description: `${a.metric} on ${a.service} closed from the anomaly card` }),
                                    onError: (e: Error) => toast.error('Transition rejected', { description: e.message }),
                                  },
                                )
                              }
                            >
                              resolve
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <button
                        className="mt-2 w-full rounded-md border border-dashed py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:opacity-50"
                        disabled={promote.isPending || promoted.has(keyOf(a.service, a.metric))}
                        onClick={() => {
                          promote.mutate(
                            {
                              service: a.service,
                              metric: a.metric,
                              severity: a.severity,
                              message: a.message,
                              baseline: a.baseline,
                              observed: a.observed,
                            },
                            {
                              onSuccess: (r) => {
                                setPromoted((prev) => new Set(prev).add(keyOf(a.service, a.metric)))
                                toast.success(r.deduplicated ? 'Already in the register' : 'Promoted to incident', {
                                  description: `${a.metric} on ${a.service} is now tracked under Alerts.`,
                                })
                              },
                              onError: (e: Error) =>
                                toast.error('Promotion rejected', { description: e.message }),
                            },
                          )
                        }}
                      >
                        {promoted.has(keyOf(a.service, a.metric)) ? 'In the register →' : promote.isPending ? 'Promoting…' : 'Promote to incident'}
                      </button>
                    )
                  })()}
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-ok/25 bg-ok/5 p-4 text-center">
                <div className="text-[12px] font-medium text-foreground/80">Fleet nominal</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  No series breached their baselines. Anomaly windows from the gateway generator fire every ~90s, so this
                  feed populates on its own.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Forecast + health */}
        <div className="space-y-3 lg:col-span-3">
          <div className="card-surface">
            <SectionHeader
              title="Forecast"
              hint="damped Holt · 95% band · 12 steps ahead"
              right={<LineChartIcon className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <div className="px-2 pb-3">
              {forecasts.length ? (
                <>
                  <div className="flex flex-wrap gap-1.5 px-2 pb-2">
                    {forecasts.map((f, i) => (
                      <button
                        key={`${f.service}-${f.series}`}
                        onClick={() => setForecastIdx(i)}
                        className={cn(
                          'rounded-full border px-2.5 py-0.5 font-mono text-[10px] transition-colors',
                          i === forecastIdx ? 'border-transparent bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {f.series} · {f.service}
                      </button>
                    ))}
                  </div>
                  <AreaChart
                    data={fc.points.map((p) => ({ ts: p.ts, value: p.value }))}
                    band={fc.points.map((p) => ({ ts: p.ts, value: p.upper }))}
                    color={FORECAST_COLOR}
                    height={200}
                    unit={fc.series === 'request.rate' ? '/s' : '%'}
                  />
                </>
              ) : (
                <EmptyState title="Forecast warming up" hint="needs ~30 minutes of series history" />
              )}
            </div>
          </div>

          <div className="card-surface">
            <SectionHeader title="Service health scores" hint="penalty model over live metrics" />
            <div className="space-y-1.5 px-4 pb-4">
              {health.map((h) => {
                const tone = statusTone(h.status)
                return (
                  <div key={h.service} className="flex items-center gap-3 rounded-lg border bg-card/40 px-3 py-2">
                    <span className="font-mono text-[11px]">{h.service}</span>
                    {(h as { kind?: string }).kind === 'host' && (
                      <span
                        className="rounded border border-muted-foreground/30 bg-muted/40 px-1 font-mono text-[9px] uppercase text-muted-foreground"
                        title="aggregated host telemetry from the C pulseagent (real /proc) plus the simulated host"
                      >
                        host
                      </span>
                    )}
                    <div className="ml-auto flex w-40 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${h.score}%`, background: TONE_COLOR[tone] }}
                        />
                      </div>
                      <span className="w-7 text-right text-[11px] font-semibold tabular">{h.score}</span>
                    </div>
                    <StatusPill status={h.status} className="w-20 justify-center" />
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-[10px] text-muted-foreground">
        engine last pulled from the gateway at {anomalies[0]?.detectedAt ? fmtClock(anomalies[0].detectedAt) : '—'} ·
        pull interval 5s · algorithms: <code className="font-mono">detectors.py</code> · explainable scoring over rolling baselines
      </div>
    </div>
  )
}
