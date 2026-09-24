import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isUpStatus } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/sites/:id - probe the endpoint NOW and persist the result
 * (status, latency, http code). Used by the admin panel "Check now" button.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const site = await db.monitoredSite.findUnique({ where: { id } })
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 })

  const started = Date.now()
  let httpStatus: number | null = null
  try {
    const res = await fetch(site.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000),
      headers: { 'user-agent': 'Lodestar-Admin-Check/1.0', accept: '*/*' },
      cache: 'no-store',
    })
    httpStatus = res.status
  } catch {
    httpStatus = null // network error / dns / timeout
  }
  const latency = Date.now() - started

  const lastStatus = httpStatus !== null && isUpStatus(httpStatus) ? 'up' : 'down'
  const updated = await db.monitoredSite.update({
    where: { id },
    data: { lastStatus, lastHttpStatus: httpStatus, lastLatencyMs: latency, lastCheckedAt: new Date() },
  })

  return NextResponse.json({
    site: updated,
    probe: { ok: lastStatus === 'up', httpStatus, latencyMs: latency },
  })
}

/** DELETE /api/admin/sites/:id - stop monitoring this endpoint. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const site = await db.monitoredSite.findUnique({ where: { id } })
  if (!site) return NextResponse.json({ error: 'site not found' }, { status: 404 })
  await db.monitoredSite.delete({ where: { id } })
  return NextResponse.json({ deleted: true, id })
}
