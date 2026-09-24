import { db } from '@/lib/db'
import { gateway, reporting } from '@/lib/upstream'

// ---------------------------------------------------------------------------
// Lodestar rule evaluator
//
// One shared engine powers three surfaces:
//   - POST /api/alerts/rules/test          (manual test-fire / drills)
//   - POST /api/alerts/rules/evaluate-all  (on-demand sweep)
//   - the background loop (instrumentation.ts) + sweep-on-read guard,
//     which promote breaches into real incidents and auto-resolve them
//     when the condition clears.
// ---------------------------------------------------------------------------

const COMPARATORS = new Set(['above', 'below'])
const SEVERITIES = new Set(['critical', 'warning', 'info'])
const METRIC_RE = /^[a-z][a-z0-9._]{1,64}$/

/** Report-backed metrics: evaluated against the newest SLA report, not the gateway. */
export const SLO_METRICS = new Set(['slo.burn_rate', 'slo.availability'])

export interface Evaluation {
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

export type RuleShape = {
  serviceKey: string
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  severity: string
}

/** Average of the freshest points in a series (last 3 samples beat single-point noise). */
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

/** Gateway-telemetry evaluation for a single rule. */
export async function evaluate(rule: RuleShape): Promise<Evaluation> {
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
export async function evaluateSlo(rule: RuleShape): Promise<Evaluation> {
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

export function evaluateRule(rule: RuleShape): Promise<Evaluation> {
  return rule.metric.startsWith('slo.') ? evaluateSlo(rule) : evaluate(rule)
}

// ---- sweep engine (background promotion of breaches) -----------------------

export type SweepAction = 'fired' | 'deduped' | 'auto-resolved' | 'quiet' | 'not-evaluable' | 'error'

export interface SweepRuleResult {
  ruleId: string
  serviceKey: string
  metric: string
  evaluable: boolean
  wouldFire: boolean
  currentValue: number | null
  action: SweepAction
  reason: string
  incidentId?: string
}

export interface SweepResult {
  at: string
  durationMs: number
  checked: number
  fired: number
  deduped: number
  autoResolved: number
  quiet: number
  notEvaluable: number
  errors: number
  results: SweepRuleResult[]
}

interface EvaluatorGlobal {
  __lodestarLastSweep?: SweepResult | null
  __lodestarSweepInProgress?: boolean
  __lodestarEvaluatorLoop?: ReturnType<typeof setInterval> | null
}

const g = globalThis as typeof globalThis & EvaluatorGlobal
g.__lodestarLastSweep ??= null
g.__lodestarSweepInProgress = false
g.__lodestarEvaluatorLoop ??= null

export function lastSweep(): SweepResult | null {
  return g.__lodestarLastSweep ?? null
}

export function sweepInProgress(): boolean {
  return Boolean(g.__lodestarSweepInProgress)
}

function ruleLabel(rule: RuleShape): string {
  return `${rule.metric} ${rule.comparator} ${rule.threshold} on ${rule.serviceKey}`
}

/**
 * Evaluate every enabled rule and act on the verdicts:
 *   breach        -> register a real incident (source=rule, dedupKey rule:<id>)
 *   breach + open -> count as deduplicated (no spam while the incident is open)
 *   cleared       -> auto-resolve the rule's incident ONLY while it is still
 *                    untouched (status=triggered); acked/mitigated ones stay
 *                    open for a human to close.
 */
export async function runSweep(): Promise<SweepResult> {
  if (g.__lodestarSweepInProgress) {
    return lastSweep() ?? {
      at: new Date().toISOString(), durationMs: 0, checked: 0, fired: 0, deduped: 0,
      autoResolved: 0, quiet: 0, notEvaluable: 0, errors: 0, results: [],
    }
  }
  g.__lodestarSweepInProgress = true
  const started = Date.now()
  const results: SweepRuleResult[] = []

  try {
    const rules = await db.alertRule.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })

    for (const rule of rules) {
      const shape: RuleShape = {
        serviceKey: rule.serviceKey,
        metric: rule.metric,
        comparator: rule.comparator,
        threshold: rule.threshold,
        windowMinutes: rule.windowMinutes,
        severity: rule.severity,
      }
      let evaluation: Evaluation
      try {
        evaluation = await evaluateRule(shape)
      } catch (err) {
        results.push({
          ruleId: rule.id,
          serviceKey: rule.serviceKey,
          metric: rule.metric,
          evaluable: false,
          wouldFire: false,
          currentValue: null,
          action: 'error',
          reason: err instanceof Error ? err.message : 'evaluation failed',
        })
        continue
      }

      const dedupKey = `rule:${rule.id}`
      const base = {
        ruleId: rule.id,
        serviceKey: rule.serviceKey,
        metric: rule.metric,
        evaluable: evaluation.evaluable,
        wouldFire: evaluation.wouldFire,
        currentValue: evaluation.currentValue,
      }

      if (!evaluation.evaluable) {
        results.push({ ...base, action: 'not-evaluable', reason: evaluation.reason })
        continue
      }

      const open = await db.incident.findFirst({
        where: { dedupKey, status: { not: 'resolved' } },
        orderBy: { startedAt: 'desc' },
      })

      if (evaluation.wouldFire) {
        if (open) {
          results.push({ ...base, action: 'deduped', reason: `breach persists · incident already open (${open.id})` })
          continue
        }
        const now = new Date()
        const incident = await db.incident.create({
          data: {
            serviceKey: rule.serviceKey,
            title: `[rule] ${ruleLabel(rule)}`,
            severity: rule.severity,
            status: 'triggered',
            source: 'rule',
            dedupKey,
            startedAt: now,
            timeline: JSON.stringify([
              {
                ts: now.toISOString(),
                event: 'triggered',
                detail: `background evaluator · ${ruleLabel(rule)} · current ${evaluation.currentValue ?? 'n/a'} · ${evaluation.reason}`,
              },
            ]),
          },
        })
        results.push({ ...base, action: 'fired', reason: evaluation.reason, incidentId: incident.id })
        continue
      }

      // Condition cleared - auto-resolve only untouched (triggered) incidents.
      if (open && open.status === 'triggered') {
        const now = new Date()
        const timeline: { ts: string; event: string; detail: string }[] = JSON.parse(open.timeline || '[]')
        timeline.push({
          ts: now.toISOString(),
          event: 'resolved',
          detail: `auto-resolved · condition cleared: current ${evaluation.currentValue ?? 'n/a'} ${rule.comparator} threshold ${rule.threshold}`,
        })
        await db.incident.update({
          where: { id: open.id },
          data: { status: 'resolved', resolvedAt: now, timeline: JSON.stringify(timeline) },
        })
        results.push({ ...base, action: 'auto-resolved', reason: `condition cleared · incident ${open.id} auto-resolved`, incidentId: open.id })
        continue
      }

      results.push({ ...base, action: 'quiet', reason: evaluation.reason })
    }

    const sweep: SweepResult = {
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
      checked: rules.length,
      fired: results.filter((r) => r.action === 'fired').length,
      deduped: results.filter((r) => r.action === 'deduped').length,
      autoResolved: results.filter((r) => r.action === 'auto-resolved').length,
      quiet: results.filter((r) => r.action === 'quiet').length,
      notEvaluable: results.filter((r) => r.action === 'not-evaluable').length,
      errors: results.filter((r) => r.action === 'error').length,
      results,
    }
    g.__lodestarLastSweep = sweep
    return sweep
  } finally {
    g.__lodestarSweepInProgress = false
  }
}

/**
 * Sweep-on-read guard: fire-and-forget a sweep when the last one is older
 * than minIntervalMs. Used by GET /api/alerts so the evaluator keeps running
 * even in environments where the instrumentation hook never booted.
 */
export function maybeSweep(minIntervalMs = 60_000): void {
  if (g.__lodestarSweepInProgress) return
  const last = g.__lodestarLastSweep
  if (last && Date.now() - new Date(last.at).getTime() < minIntervalMs) return
  void runSweep().catch(() => {
    // sweep errors are recorded on the result; never break the caller
  })
}

/** Background loop started from instrumentation.ts (60s cadence). */
export function startEvaluatorLoop(intervalMs = 60_000): void {
  if (g.__lodestarEvaluatorLoop) return
  // give the planes a moment after boot before the first sweep
  setTimeout(() => {
    void runSweep().catch(() => {})
  }, 15_000).unref?.()
  g.__lodestarEvaluatorLoop = setInterval(() => {
    void runSweep().catch(() => {})
  }, intervalMs)
  if (typeof g.__lodestarEvaluatorLoop.unref === 'function') g.__lodestarEvaluatorLoop.unref()
}

export { COMPARATORS, SEVERITIES, METRIC_RE }
