import { NextRequest, NextResponse } from 'next/server'
import { reporting, type SlaReportRequest } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

const MAX_WINDOW_DAYS = 90
const SERVICE_RE = /^[a-z0-9][a-z0-9._-]{1,62}$/i

/**
 * GET /api/reports?serviceId=&limit=
 * Lists SLA reports persisted by the C# reporting plane (:4200), newest first.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const serviceId = sp.get('serviceId') ?? ''
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 10) || 10, 1), 50)

  const data = await reporting.reports(serviceId, limit)
  if (!data) {
    return NextResponse.json(
      { error: 'reporting plane unavailable', reports: [], count: 0 },
      { status: 502 },
    )
  }
  return NextResponse.json(data)
}

/**
 * POST /api/reports
 * Generates an SLA report through reporting-core. Body:
 *   { serviceId, windowDays, sloTarget }  (window ends "now", UTC)
 * Validation mirrors the C# model so bad input fails fast at the edge.
 */
export async function POST(req: NextRequest) {
  let body: { serviceId?: string; windowDays?: number; sloTarget?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const serviceId = (body.serviceId ?? '').trim()
  if (!SERVICE_RE.test(serviceId)) {
    return NextResponse.json({ error: 'serviceId must be 2-63 chars [a-z0-9._-]' }, { status: 400 })
  }
  const windowDays = Math.min(Math.max(Math.round(Number(body.windowDays ?? 14) || 14), 1), MAX_WINDOW_DAYS)
  const sloTarget = body.sloTarget === undefined ? undefined : Number(body.sloTarget)
  if (sloTarget !== undefined && (!(sloTarget > 50) || sloTarget > 99.9999)) {
    return NextResponse.json({ error: 'sloTarget must be between 50 and 99.9999' }, { status: 400 })
  }

  const to = new Date()
  const from = new Date(to.getTime() - windowDays * 24 * 60 * 60 * 1000)
  const payload: SlaReportRequest = {
    serviceId,
    from: from.toISOString(),
    to: to.toISOString(),
    ...(sloTarget !== undefined ? { sloTarget } : {}),
  }

  const report = await reporting.sla(payload)
  if (!report) {
    return NextResponse.json(
      { error: 'reporting plane unavailable or rejected the request' },
      { status: 502 },
    )
  }
  return NextResponse.json(report, { status: 201 })
}
