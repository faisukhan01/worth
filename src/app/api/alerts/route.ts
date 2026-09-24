import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { maybeSweep } from '@/lib/rule-evaluator'

export const dynamic = 'force-dynamic'

const SEVERITIES = new Set(['critical', 'warning', 'info'])
const COMPARATORS = new Set(['above', 'below'])
const METRIC_RE = /^[a-z][a-z0-9._]{1,64}$/

/**
 * GET /api/alerts
 * Alert rules + incident register (open incidents first).
 * Also nudges the background evaluator: if the last sweep is older than a
 * minute, one is kicked off fire-and-forget so rule breaches keep flowing
 * into the register even without the instrumentation hook.
 */
export async function GET() {
  maybeSweep()
  const [rules, incidents] = await Promise.all([
    db.alertRule.findMany({ orderBy: { createdAt: 'desc' } }),
    db.incident.findMany({ orderBy: { startedAt: 'desc' }, take: 40 }),
  ])
  const open = incidents.filter((i) => i.status !== 'resolved')
  const closed = incidents.filter((i) => i.status === 'resolved')
  return NextResponse.json({
    rules,
    incidents: [...open, ...closed],
    counts: {
      open: open.length,
      triggered: open.filter((i) => i.status === 'triggered').length,
      acknowledged: open.filter((i) => i.status === 'acknowledged').length,
      mitigated: open.filter((i) => i.status === 'mitigated').length,
      resolved: closed.length,
      rules: rules.length,
      rulesEnabled: rules.filter((r) => r.enabled).length,
    },
  })
}

/**
 * POST /api/alerts - create an alert rule.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

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

  const svc = await db.service.findUnique({ where: { key: serviceKey } })
  if (!svc) return NextResponse.json({ error: 'unknown service' }, { status: 404 })

  const rule = await db.alertRule.create({
    data: { serviceKey, metric, comparator, threshold, windowMinutes, severity },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
