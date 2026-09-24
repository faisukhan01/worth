import { NextRequest, NextResponse } from 'next/server'
import { gateway } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

const LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])

const FALLBACK_TEMPLATES: Record<string, string[]> = {
  'api-gateway': [
    'upstream pool resized to {n} connections',
    'request batch flushed in {n}ms',
    'tls handshake completed for sni edge-1.lodestar.dev',
  ],
  'checkout-service': [
    'payment intent authorised in {n}ms',
    'retrying psp call (attempt 2) - connection pool saturating',
    'idempotency key cache hit ratio {n}',
  ],
  'auth-service': [
    'token issued subject=svc-billing ttl=900s',
    'jwt refresh burst handled ({n} rps)',
    'mfa challenge verified',
  ],
  'search-cluster': [
    'shard rebalance {n}% complete',
    'query plan cache warmed',
    'slow query detected: {n}ms',
  ],
  'billing-worker': [
    'invoice batch {n} lines queued',
    'usage rollup checkpoint committed',
    'overage evaluation finished for period',
  ],
  'edge-cdn': [
    'pop eu-west hit ratio {n}',
    'purge propagated to {n} nodes',
    'origin shield absorbed burst',
  ],
}

function syntheticLogs(limit: number, level: string, service: string, q: string) {
  const services = Object.keys(FALLBACK_TEMPLATES).filter((s) => !service || s === service)
  const out: { level: string; service: string; message: string; ts: number }[] = []
  const now = Date.now()
  for (let i = 0; i < limit; i++) {
    const svc = services[i % Math.max(services.length, 1)] ?? 'api-gateway'
    const roll = (i * 37) % 100
    const lvl = roll > 92 ? 'error' : roll > 78 ? 'warn' : roll > 30 ? 'info' : 'debug'
    if (level && lvl !== level) continue
    const tpl = FALLBACK_TEMPLATES[svc][i % FALLBACK_TEMPLATES[svc].length]
    const msg = tpl.replace('{n}', String(10 + ((i * 13) % 400)))
    if (q && !msg.includes(q.toLowerCase())) continue
    out.push({ level: lvl, service: svc, message: msg, ts: now - i * 1500 })
  }
  return out
}

/**
 * GET /api/logs?limit=200&level=error&service=checkout-service&q=pool
 * Live log search backed by the gateway ring buffer. When the gateway is
 * unreachable the route degrades to a labelled synthetic feed so the console
 * remains demonstrable (docs/operations.md -> degradation protocol).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 200) || 200, 10), 1000)
  const level = sp.get('level') ?? ''
  if (level && !LEVELS.has(level)) {
    return NextResponse.json({ error: 'invalid level' }, { status: 400 })
  }
  const service = sp.get('service') ?? ''
  const q = (sp.get('q') ?? '').slice(0, 120)

  const data = await gateway.logs(limit, level, service, q)
  if (data) {
    return NextResponse.json({ ...data, source: 'gateway' })
  }
  const fallback = syntheticLogs(Math.min(limit, 60), level, service, q)
  return NextResponse.json({ logs: fallback, total: fallback.length, source: 'synthetic' })
}
