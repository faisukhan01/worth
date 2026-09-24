import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const ORDER = ['triggered', 'acknowledged', 'mitigated', 'resolved']

const TRANSITIONS: Record<string, { next: string; event: string }> = {
  acknowledge: { next: 'acknowledged', event: 'acknowledged' },
  mitigate: { next: 'mitigated', event: 'mitigated' },
  resolve: { next: 'resolved', event: 'resolved' },
}

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

/**
 * POST /api/incidents/bulk
 *
 * Apply a lifecycle action and/or an assignee to many incidents in one call.
 * Body: { ids: string[], action?: "acknowledge"|"mitigate"|"resolve", assignee?: string|null, detail? }
 *
 * Per-id best effort: a 409 on one incident does not abort the rest.
 * Responds { updated, results: [{ id, ok, error? }] }.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 50) : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }

  const action = String(body.action ?? '')
  const detail = String(body.detail ?? '').slice(0, 300)
  const hasAssignee = 'assignee' in body
  const assignee = hasAssignee ? (body.assignee === null ? null : String(body.assignee).slice(0, 80)) : undefined
  const transition = action ? TRANSITIONS[action] : undefined

  if (!action && !hasAssignee) {
    return NextResponse.json({ error: 'provide action or assignee' }, { status: 400 })
  }
  if (action && !transition) {
    return NextResponse.json({ error: 'action must be acknowledge|mitigate|resolve' }, { status: 400 })
  }

  const results: { id: string; ok: boolean; error?: string }[] = []
  let updated = 0

  for (const id of ids) {
    const incident = await db.incident.findUnique({ where: { id } })
    if (!incident) {
      results.push({ id, ok: false, error: 'not found' })
      continue
    }

    const timeline: TimelineEntry[] = JSON.parse(incident.timeline || '[]')
    const data: { status?: string; acknowledgedAt?: Date; resolvedAt?: Date; assignee?: string | null } = {}

    if (hasAssignee && assignee !== incident.assignee) {
      data.assignee = assignee
      timeline.push({
        ts: new Date().toISOString(),
        event: 'assignment',
        detail: assignee ? `assigned to ${assignee} (bulk)` : 'assignee cleared (bulk)',
      })
    }

    if (action && transition) {
      const currentIdx = ORDER.indexOf(incident.status)
      const nextIdx = ORDER.indexOf(transition.next)
      if (currentIdx >= nextIdx && action !== 'resolve') {
        results.push({ id, ok: false, error: `already ${incident.status}` })
        continue
      }
      data.status = transition.next
      data.acknowledgedAt = action === 'acknowledge' ? new Date() : incident.acknowledgedAt
      data.resolvedAt = action === 'resolve' ? new Date() : incident.resolvedAt
      timeline.push({
        ts: new Date().toISOString(),
        event: transition.event,
        detail: detail || `${transition.event} via bulk action`,
      })
    }

    try {
      await db.incident.update({ where: { id }, data: { ...data, timeline: JSON.stringify(timeline) } })
      results.push({ id, ok: true })
      updated += 1
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : 'update failed' })
    }
  }

  return NextResponse.json({ updated, results })
}
