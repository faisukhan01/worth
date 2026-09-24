import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TRANSITIONS: Record<string, { next: string; event: string }[]> = {
  acknowledge: [
    { next: 'acknowledged', event: 'acknowledged' },
  ],
  mitigate: [
    { next: 'mitigated', event: 'mitigated' },
    { next: 'mitigated', event: 'mitigation applied' },
  ],
  resolve: [
    { next: 'resolved', event: 'resolved' },
    { next: 'resolved', event: 'resolved' },
  ],
}

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

/**
 * PATCH /api/incidents/:id - lifecycle transitions.
 * Body: { action: "acknowledge" | "mitigate" | "resolve", detail?: string }
 * Invalid transitions are rejected with 409.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const action = String(body.action ?? '')
  const detail = String(body.detail ?? '').slice(0, 300)
  const rule = TRANSITIONS[action]
  if (!rule) {
    return NextResponse.json({ error: 'action must be acknowledge|mitigate|resolve' }, { status: 400 })
  }

  const incident = await db.incident.findUnique({ where: { id } })
  if (!incident) return NextResponse.json({ error: 'incident not found' }, { status: 404 })

  const transition =
    action === 'acknowledge' ? rule[0] : action === 'mitigate' ? rule[0] : rule[0]

  const order = ['triggered', 'acknowledged', 'mitigated', 'resolved']
  const currentIdx = order.indexOf(incident.status)
  const nextIdx = order.indexOf(transition.next)
  if (currentIdx >= nextIdx && action !== 'resolve') {
    return NextResponse.json(
      { error: `cannot ${action} an incident already in "${incident.status}"` },
      { status: 409 },
    )
  }

  const timeline: TimelineEntry[] = JSON.parse(incident.timeline || '[]')
  timeline.push({
    ts: new Date().toISOString(),
    event: transition.event,
    detail: detail || `${transition.event} via console`,
  })

  const updated = await db.incident.update({
    where: { id },
    data: {
      status: transition.next,
      acknowledgedAt: action === 'acknowledge' ? new Date() : incident.acknowledgedAt,
      resolvedAt: action === 'resolve' ? new Date() : incident.resolvedAt,
      timeline: JSON.stringify(timeline),
    },
  })
  return NextResponse.json({ incident: updated })
}
