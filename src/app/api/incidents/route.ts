import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SEVERITIES = new Set(['critical', 'warning', 'info'])

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

/**
 * POST /api/incidents
 * Promote an AIOps anomaly (or a manual observation) into the incident
 * register. Deduplicates open incidents per (serviceKey, title) so repeated
 * promotions of the same rolling anomaly do not spam the register.
 *
 * Body: { serviceKey, title, severity, detail?, source? }
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const serviceKey = String(body.serviceKey ?? '')
  const title = String(body.title ?? '').trim().slice(0, 160)
  const severity = String(body.severity ?? 'warning')
  const detail = String(body.detail ?? '').slice(0, 300)
  const source = String(body.source ?? 'aiops') === 'manual' ? 'manual' : 'aiops'

  if (!serviceKey || title.length < 4 || !SEVERITIES.has(severity)) {
    return NextResponse.json(
      { error: 'serviceKey, title (>=4 chars) and severity (critical|warning|info) are required' },
      { status: 400 },
    )
  }

  const svc = await db.service.findUnique({ where: { key: serviceKey } })
  if (!svc) return NextResponse.json({ error: 'unknown service' }, { status: 404 })

  const duplicate = await db.incident.findFirst({
    where: { serviceKey, title, status: { in: ['triggered', 'acknowledged', 'mitigated'] } },
  })
  if (duplicate) {
    return NextResponse.json({ incident: duplicate, deduplicated: true }, { status: 200 })
  }

  const timeline: TimelineEntry[] = [
    {
      ts: new Date().toISOString(),
      event: 'triggered',
      detail: detail || `Promoted from AIOps anomaly feed (${source})`,
    },
  ]

  const incident = await db.incident.create({
    data: {
      serviceKey,
      title,
      severity,
      status: 'triggered',
      source,
      timeline: JSON.stringify(timeline),
    },
  })
  return NextResponse.json({ incident, deduplicated: false }, { status: 201 })
}
