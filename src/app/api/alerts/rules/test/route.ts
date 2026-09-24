import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { gateway, reporting } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

const COMPARATORS = new Set(['above', 'below'])
const SEVERITIES = new Set(['critical', 'warning', 'info'])
const METRIC_RE = /^[a-z][a-z0-9._]{1,64}$/

/** Report-backed metrics: evaluated against the newest SLA report, not the gateway. */
const SLO_METRICS = new Set(['slo.burn_rate', 'slo.availability'])

interface Evaluation {
  serviceKey: string
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  severity: string
  currentValue: number | null
  sampleCount: number
  evaluable: boolean
  wouldFire: boolean
  reason: string
  evaluatedAt: string
  /** Present when the rule is report-backed (metric slo.*). */
  reportId?: string
  reportFrom?: string
  reportTo?: string
  sloTarget?: number
}

/**
 * Average of the freshest points in a series. Uses up to the last 3 samples so
 * a single noisy point does not flip the verdict, but still reflects "now".
 */
function latestValue(points: { ts: number; value: number }[]): { value: number; count: number } | null {
  if (points.length === 0) return null
  const tail = points.slice(-3)
  const value = tail.reduce((s, p) => s + p.value, 0) / tail.length
  return { value, count: tail.length }
}

/**
 * Snap a rule window to a range the gateway accepts. Gateway only allows
 * {5m,15m,30m,1h,3h,6h,24h}, so e.g. a 10m rule evaluates on 15m of data.
 */
function snapRange(windowMinutes: number): string {
  const allowed: [number, string][] = [
    [5, '5m'], [15, '15m'], [30, '30m'], [60, '1h'], [180, '3h'], [360, '6h'], [1440, '24h'],
  ]
  for (const [minutes, range] of allowed) {
    if (windowMinutes <= minutes) return range
  }
  return '24h'
}

async function evaluate(rule: {
  serviceKey: string
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  severity: string
}): Promise<Evaluation> {
  const evaluatedAt = new Date().toISOString()
  let series: { points: { ts: number; value: number }[] }[] = []
  try {
    const res = await gateway.metrics(rule.metric, snapRange(rule.windowMinutes), 12, { service: rule.serviceKey })
    series = res.series ?? []
  } catch {
    return {
      ...rule,
      currentValue: null,
      sampleCount: 0,
      evaluable: false,
      wouldFire: false,
      reason: 'gateway unreachable or metric stream unavailable',
      evaluatedAt,
    }
  }

  let match = series.find((s) => s.tags?.service === rule.serviceKey) ?? series[0]
  let scope: string = rule.serviceKey
  // Host metrics (cpu.usage, mem.used, ...) are emitted by the C pulseagent
  // without a service tag. If the service-scoped query came back empty, fall
  // back to the real agent feed so host rules stay evaluable.
  if (!match || (match.points ?? []).length === 0) {
    try {
      const res = await gateway.metrics(rule.metric, snapRange(rule.windowMinutes), 12)
      const agentSeries = (res.series ?? []).filter((s) => s.tags?.source !== 'simulated')
      if (agentSeries.length > 0) {
        match = agentSeries[0]
        scope = 'host telemetry'
      }
    } catch {
      // keep the service-scoped result below
    }
  }
  const sample = match ? latestValue(match.points ?? []) : null
  if (!sample) {
    return {
      ...rule,
      currentValue: null,
      sampleCount: 0,
      evaluable: false,
      wouldFire: false,
      reason: `no samples for ${scope}/${rule.metric} in the last ${rule.windowMinutes}m`,
      evaluatedAt,
    }
  }

  const wouldFire = rule.comparator === 'above' ? sample.value > rule.threshold : sample.value < rule.threshold
  return {
    ...rule,
    currentValue: Math.round(sample.value * 1000) / 1000,
    sampleCount: sample.count,
    evaluable: true,
    wouldFire,
    reason: wouldFire
      ? `${rule.comparator} ${rule.threshold} breached (avg of last ${sample.count} samples)`
      : `${rule.comparator} ${rule.threshold} not breached (avg of last ${sample.count} samples)`,
    evaluatedAt,
  }
}

/**
 * Report-backed evaluation: reads the newest SLA report the C# plane has for
 * the service, so burn-rate / availability rules alert on SLO health instead
 * of raw gateway series. No window applies - the report carries its own.
 */
async function evaluateSlo(rule: {
  serviceKey: string
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  severity: string
}): Promise<Evaluation> {
  const evaluatedAt = new Date().toISOString()
  const data = await reporting.reports(rule.serviceKey, 10)
  const latest = (data?.reports ?? [])
    .slice()
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0))[0]
  if (!latest) {
    return {
      ...rule,
      currentValue: null,
      sampleCount: 0,
      evaluable: false,
      wouldFire: false,
      reason: `no SLA report found for ${rule.serviceKey} - generate one from the Reports view`,
      evaluatedAt,
    }
  }
  const s = latest.summary
  const currentValue = rule.metric === 'slo.burn_rate' ? s.burnRate : s.availabilityPct
  const rounded = Math.round(currentValue * 1000) / 1000
  const wouldFire = rule.comparator === 'above' ? currentValue > rule.threshold : currentValue < rule.threshold
  const label = rule.metric === 'slo.burn_rate' ? 'burn rate' : 'availability'
  return {
    ...rule,
    currentValue: rounded,
    sampleCount: 1,
    evaluable: true,
    wouldFire,
    reason: `${label} ${rounded} ${rule.comparator} ${rule.threshold} · report window ${latest.from.slice(0, 10)} → ${latest.to.slice(0, 10)} (SLO target ${latest.sloTarget}%)`,
    reportId: latest.id,
    reportFrom: latest.from,
    reportTo: latest.to,
    sloTarget: latest.sloTarget,
    evaluatedAt,
  }
}

/**
 * POST /api/alerts/rules/test
 *
 * Test-fire an alert rule against live gateway telemetry (or the newest SLA
 * report for slo.* metrics).
 *
 * Body (either):
 *   { ruleId, mode? }                       - test a saved rule
 *   { serviceKey, metric, comparator, threshold, windowMinutes?, severity?, mode? } - dry-run an unsaved rule
 *
 * mode:
 *   'evaluate' (default) - read-only evaluation, no side effects
 *   'drill'              - additionally registers a drill incident (source=drill)
 *                          so on-call can rehearse the acknowledge/mitigate flow
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const mode = String(body.mode ?? 'evaluate')
  if (mode !== 'evaluate' && mode !== 'drill') {
    return NextResponse.json({ error: "mode must be 'evaluate' or 'drill'" }, { status: 400 })
  }

  let rule: { serviceKey: string; metric: string; comparator: string; threshold: number; windowMinutes: number; severity: string }
  let ruleId: string | null = null
  let ruleLabel: string

  if (body.ruleId) {
    const saved = await db.alertRule.findUnique({ where: { id: String(body.ruleId) } })
    if (!saved) return NextResponse.json({ error: 'unknown rule' }, { status: 404 })
    rule = {
      serviceKey: saved.serviceKey,
      metric: saved.metric,
      comparator: saved.comparator,
      threshold: saved.threshold,
      windowMinutes: saved.windowMinutes,
      severity: saved.severity,
    }
    ruleId = saved.id
    ruleLabel = `${saved.metric} ${saved.comparator} ${saved.threshold} on ${saved.serviceKey}`
  } else {
    const serviceKey = String(body.serviceKey ?? '')
    const metric = String(body.metric ?? '')
    const comparator = String(body.comparator ?? 'above')
    const threshold = Number(body.threshold)
    const windowMinutes = Math.min(Math.max(Number(body.windowMinutes ?? 5) || 5, 1), 120)
    const severity = String(body.severity ?? 'warning')

    if (!serviceKey || !metric || !METRIC_RE.test(metric) || !COMPARATORS.has(comparator) ||
        !Number.isFinite(threshold) || !SEVERITIES.has(severity)) {
      return NextResponse.json({ error: 'invalid rule payload' }, { status: 400 })
    }
    if (metric.startsWith('slo.') && !SLO_METRICS.has(metric)) {
      return NextResponse.json(
        { error: `unknown SLO metric '${metric}' (supported: ${[...SLO_METRICS].join(', ')})` },
        { status: 400 },
      )
    }
    const svc = await db.service.findUnique({ where: { key: serviceKey } })
    if (!svc) return NextResponse.json({ error: 'unknown service' }, { status: 404 })

    rule = { serviceKey, metric, comparator, threshold, windowMinutes, severity }
    ruleLabel = `${metric} ${comparator} ${threshold} on ${serviceKey}`
  }

  const evaluation = rule.metric.startsWith('slo.') ? await evaluateSlo(rule) : await evaluate(rule)

  if (mode === 'drill') {
    const dedupKey = `drill:${ruleId ?? `${rule.serviceKey}:${rule.metric}:${rule.comparator}:${rule.threshold}`}`
    const existing = await db.incident.findFirst({
      where: { dedupKey, status: { not: 'resolved' } },
    })
    if (existing) {
      return NextResponse.json(
        { evaluation, drill: { id: existing.id, deduplicated: true, title: existing.title } },
        { status: 200 },
      )
    }
    const now = new Date()
    const incident = await db.incident.create({
      data: {
        serviceKey: rule.serviceKey,
        title: `[drill] ${rule.metric} ${rule.comparator} ${rule.threshold}`,
        severity: rule.severity,
        status: 'triggered',
        source: 'drill',
        dedupKey,
        startedAt: now,
        timeline: JSON.stringify([
          {
            ts: now.toISOString(),
            event: 'triggered',
            detail: `drill test-fire from console · ${ruleLabel} · current ${evaluation.currentValue ?? 'n/a'}`,
          },
        ]),
      },
    })
    return NextResponse.json(
      { evaluation, drill: { id: incident.id, deduplicated: false, title: incident.title } },
      { status: 201 },
    )
  }

  return NextResponse.json({ evaluation, ruleId })
}
