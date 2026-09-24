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
 * PATCH /api/incidents/:id - lifecycle transitions and assignment.
 * Body: { action: "acknowledge" | "mitigate" | "resolve", detail?, assignee? }
 *        or { assignee: string | null } to (re)assign without a transition.
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
  const hasAssignee = 'assignee' in body
  const assignee = hasAssignee ? (body.assignee === null ? null : String(body.assignee).slice(0, 80)) : undefined

  const rule = TRANSITIONS[action]
  if (!action && !hasAssignee) {
    return NextResponse.json({ error: 'provide action or assignee' }, { status: 400 })
  }
  if (action && !rule) {
    return NextResponse.json({ error: 'action must be acknowledge|mitigate|resolve' }, { status: 400 })
  }

  const incident = await db.incident.findUnique({ where: { id } })
  if (!incident) return NextResponse.json({ error: 'incident not found' }, { status: 404 })

  const order = ['triggered', 'acknowledged', 'mitigated', 'resolved']
  const timeline: TimelineEntry[] = JSON.parse(incident.timeline || '[]')
  const data: Parameters<typeof db.incident.update>[0]['data'] = {}

  if (hasAssignee && assignee !== incident.assignee) {
    data.assignee = assignee
    timeline.push({
      ts: new Date().toISOString(),
      event: 'assignment',
      detail: assignee ? `assigned to ${assignee}` : 'assignee cleared',
    })
  }

  if (action) {
    const transition = rule[0]
    const currentIdx = order.indexOf(incident.status)
    const nextIdx = order.indexOf(transition.next)
    if (currentIdx >= nextIdx && action !== 'resolve') {
      return NextResponse.json(
        { error: `cannot ${action} an incident already in "${incident.status}"` },
        { status: 409 },
      )
    }
    data.status = transition.next
    data.acknowledgedAt = action === 'acknowledge' ? new Date() : incident.acknowledgedAt
    data.resolvedAt = action === 'resolve' ? new Date() : incident.resolvedAt
    timeline.push({
      ts: new Date().toISOString(),
      event: transition.event,
      detail: detail || `${transition.event} via console`,
    })
  }

  if (!action && !hasAssignee) {
    return NextResponse.json({ incident }) // no-op
  }

  const updated = await db.incident.update({
    where: { id },
    data: { ...data, timeline: JSON.stringify(timeline) },
  })
  return NextResponse.json({ incident: updated })
}
