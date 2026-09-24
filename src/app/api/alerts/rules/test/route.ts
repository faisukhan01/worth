import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { evaluateRule, SLO_METRICS, COMPARATORS, SEVERITIES, METRIC_RE, type Evaluation, type RuleShape } from '@/lib/rule-evaluator'

export const dynamic = 'force-dynamic'

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

  let rule: RuleShape
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

  const evaluation: Evaluation = await evaluateRule(rule)

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
