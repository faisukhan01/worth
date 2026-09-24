import { NextRequest, NextResponse } from 'next/server'
import { gateway } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

const RANGE_RE = /^(5m|15m|30m|1h|3h|6h|24h)$/
const NAME_RE = /^[a-z][a-z0-9._]{1,64}$/

/**
 * GET /api/metrics?names=request.rate,latency.p99&range=30m&points=120
 *                     &service=checkout-service&source=agent
 * Thin authenticated proxy to the Go gateway query API. The browser never
 * talks to the data plane directly (Caddy + gateway policy).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const names = (sp.get('names') ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => NAME_RE.test(n))
    .slice(0, 8)
  if (names.length === 0) {
    return NextResponse.json({ error: 'names parameter required' }, { status: 400 })
  }
  const range = sp.get('range') ?? '30m'
  if (!RANGE_RE.test(range)) {
    return NextResponse.json({ error: 'invalid range' }, { status: 400 })
  }
  const points = Math.min(Math.max(Number(sp.get('points') ?? 120) || 120, 10), 500)

  const filters: Record<string, string> = {}
  const service = sp.get('service')
  const source = sp.get('source')
  if (service) filters.service = service
  if (source) filters.source = source

  const data = await gateway.metrics(names.join(','), range, points, filters)
  if (!data) {
    return NextResponse.json(
      { error: 'ingest-gateway unavailable', series: [], meta: { gateway: false } },
      { status: 502 },
    )
  }
  return NextResponse.json({ ...data, meta: { ...(data as { meta?: unknown }).meta, gateway: true } })
}
