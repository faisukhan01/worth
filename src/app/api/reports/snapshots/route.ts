import { NextRequest, NextResponse } from 'next/server'
import { driftInProgress, lastDriftCycle, listSnapshots, maybeDriftCycle, runDriftCycle } from '@/lib/report-drift'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/snapshots
 * Drift-watch status: watched services, per-service snapshot history
 * (oldest -> newest) and the last background cycle summary. Also nudges the
 * background cycle when it has not run within its interval.
 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 24) || 24, 4), 48)
  maybeDriftCycle()
  const [list, cycle] = await Promise.all([listSnapshots(limit), Promise.resolve(lastDriftCycle())])
  return NextResponse.json({
    watched: list.watched,
    snapshots: list.snapshots,
    lastCycle: cycle,
    inProgress: driftInProgress(),
  })
}

/**
 * POST /api/reports/snapshots
 * Take a snapshot cycle right now. Body (all optional):
 *   { serviceId?: string, windowDays?: number }
 * Without serviceId every watched service is snapshotted. Each snapshot is
 * diffed against the previous one; drift beyond the thresholds registers (or
 * dedupes) an incident with source=report-drift.
 */
export async function POST(req: NextRequest) {
  let body: { serviceId?: string; windowDays?: number } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const serviceId = (body.serviceId ?? '').trim()
  if (serviceId && !/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(serviceId)) {
    return NextResponse.json({ error: 'serviceId must be 2-63 chars [a-z0-9._-]' }, { status: 400 })
  }
  const cycle = await runDriftCycle(serviceId || undefined)
  return NextResponse.json(cycle, { status: 201 })
}
