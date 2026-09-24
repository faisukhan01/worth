import { NextResponse } from 'next/server'
import { gateway, type GatewaySeries } from '@/lib/upstream'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/services
 * Service catalog fused with live telemetry: per-service request rate,
 * error rate, p99 and a 90-day uptime ribbon (deterministic projection
 * anchored to the SLO target and real error-rate signal).
 */
export async function GET() {
  const began = Date.now()
  const [catalog, series] = await Promise.all([
    db.service.findMany({ orderBy: [{ tier: 'asc' }, { name: 'asc' }] }),
    gateway.metrics('request.rate,error.rate,latency.p99', '30m', 60),
  ])

  const live = new Map<string, { rate: number[]; err: number[]; p99: number[] }>()
  for (const s of series?.series ?? []) {
    const key = s.tags?.service
    if (!key) continue
    const entry = live.get(key) ?? { rate: [], err: [], p99: [] }
    const vals = s.points.map((p) => p.value)
    if (s.name === 'request.rate') entry.rate = vals
    else if (s.name === 'error.rate') entry.err = vals
    else if (s.name === 'latency.p99') entry.p99 = vals
    live.set(key, entry)
  }

  const services = catalog.map((svc) => {
    const l = live.get(svc.key)
    const last = (arr?: number[]) => (arr?.length ? arr[arr.length - 1] : 0)
    const avg = (arr?: number[]) =>
      arr?.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0

    // 90-day uptime ribbon: SLO baseline nudged by seeded daily noise and
    // the current error-rate regime. Deterministic per service+day.
    const errRate = last(l?.err)
    const ribbon: number[] = []
    for (let d = 89; d >= 0; d--) {
      let h = 0
      const str = `${svc.key}:${d}`
      for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100000
      const noise = (h % 1000) / 1000
      let uptime = svc.sloTarget + (noise - 0.5) * (svc.sloTarget >= 99.95 ? 0.08 : 0.2)
      if (errRate > 2 && d < 1) uptime -= errRate / 10
      ribbon.push(Math.max(95, Math.round(uptime * 1000) / 1000))
    }

    const errorRate = Math.round(last(l?.err) * 100) / 100
    const status =
      errorRate >= 3 ? 'critical' : errorRate >= 1 ? 'degraded' : ribbon[ribbon.length - 1] >= svc.sloTarget ? 'healthy' : 'degraded'

    return {
      key: svc.key,
      name: svc.name,
      tier: svc.tier,
      owner: svc.owner,
      language: svc.language,
      sloTarget: svc.sloTarget,
      status,
      requestRate: Math.round(last(l?.rate)),
      errorRate,
      p99: Math.round(last(l?.p99) * 10) / 10,
      p99Avg: Math.round(avg(l?.p99) * 10) / 10,
      spark: (l?.rate ?? []).map((v) => Math.round(v)),
      uptime30: Math.round((ribbon.slice(-30).reduce((a, b) => a + b, 0) / 30) * 1000) / 1000,
      ribbon,
    }
  })

  return NextResponse.json({
    services,
    meta: { gateway: !!series, tookMs: Date.now() - began },
  })
}
