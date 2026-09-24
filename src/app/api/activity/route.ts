import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

export interface ActivityEvent {
  ts: string
  event: string
  detail: string
  incidentId: string
  serviceKey: string
  incidentTitle: string
}

const KNOWN = new Set(['triggered', 'acknowledged', 'mitigated', 'resolved', 'assignment'])

/**
 * GET /api/activity?limit=120&service=&event=
 *
 * Unified audit feed: flattens every incident's timeline JSON into one
 * chronological stream so on-call can see who did what, when, without
 * opening individual incidents.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 120) || 120, 1), 300)
  const service = sp.get('service') ?? ''
  const event = sp.get('event') ?? ''

  const incidents = await db.incident.findMany({
    orderBy: { startedAt: 'desc' },
    take: 200,
  })

  const events: ActivityEvent[] = []
  for (const inc of incidents) {
    let timeline: TimelineEntry[] = []
    try {
      const parsed: unknown = JSON.parse(inc.timeline || '[]')
      timeline = Array.isArray(parsed) ? (parsed as TimelineEntry[]) : []
    } catch {
      timeline = []
    }
    for (const t of timeline) {
      if (!t || typeof t.ts !== 'string' || !KNOWN.has(t.event)) continue
      if (service && inc.serviceKey !== service) continue
      if (event && t.event !== event) continue
      events.push({
        ts: t.ts,
        event: t.event,
        detail: String(t.detail ?? '').slice(0, 300),
        incidentId: inc.id,
        serviceKey: inc.serviceKey,
        incidentTitle: inc.title,
      })
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? 1 : -1))
  return NextResponse.json({
    events: events.slice(0, limit),
    total: events.length,
    services: [...new Set(incidents.map((i) => i.serviceKey))].sort(),
  })
}
