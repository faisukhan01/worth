import { NextResponse } from 'next/server'
import { gateway, aiops, type GatewaySeries } from '@/lib/upstream'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface ServiceLive {
  key: string
  requestRate: number
  errorRate: number
  p99: number
  spark: number[]
}

function latest(series?: GatewaySeries): number {
  if (!series?.points?.length) return 0
  return series.points[series.points.length - 1]?.value ?? 0
}

function sparkOf(series?: GatewaySeries): number[] {
  return series?.points?.map((p) => Math.round(p.value * 100) / 100) ?? []
}

/**
 * GET /api/overview
 * Single aggregate powering the Overview view: platform KPIs, live traffic
 * shape, host telemetry, AIOps verdict and open incident load.
 */
export async function GET() {
  const began = Date.now()

  const [stats, svcSeries, hostAgent, hostSim, insights, openIncidents, ruleCount] =
    await Promise.all([
      gateway.stats(),
      gateway.metrics('request.rate,error.rate,latency.p99', '30m', 90),
      gateway.metrics('cpu.usage,mem.used', '1h', 60, { source: 'agent' }),
      gateway.metrics('cpu.usage,mem.used', '1h', 60, { source: 'simulated' }),
      aiops.insights(),
      db.incident.findMany({
        where: { status: { in: ['triggered', 'acknowledged', 'mitigated'] } },
        orderBy: { startedAt: 'desc' },
        take: 5,
      }),
      db.alertRule.count({ where: { enabled: true } }),
    ])

  const dataUp = !!stats
  const byService = new Map<string, ServiceLive>()

  const ensure = (key: string): ServiceLive => {
    let s = byService.get(key)
    if (!s) {
      s = { key, requestRate: 0, errorRate: 0, p99: 0, spark: [] }
      byService.set(key, s)
    }
    return s
  }

  for (const series of svcSeries?.series ?? []) {
    const key = series.tags?.service
    if (!key) continue
    const svc = ensure(key)
    if (series.name === 'request.rate') {
      svc.requestRate = Math.round(latest(series))
      svc.spark = sparkOf(series)
    } else if (series.name === 'error.rate') {
      svc.errorRate = Math.round(latest(series) * 100) / 100
    } else if (series.name === 'latency.p99') {
      svc.p99 = Math.round(latest(series) * 10) / 10
    }
  }

  const services = [...byService.values()].sort((a, b) => b.requestRate - a.requestRate)
  const totalRps = services.reduce((acc, s) => acc + s.requestRate, 0)
  const weightedErr =
    totalRps > 0
      ? services.reduce((acc, s) => acc + s.errorRate * s.requestRate, 0) / totalRps
      : 0
  const weightedP99 =
    totalRps > 0
      ? services.reduce((acc, s) => acc + s.p99 * s.requestRate, 0) / totalRps
      : 0

  // Traffic sparkline: sum of per-service request rates aligned by index.
  const trafficSpark: { ts: number; value: number }[] = []
  const rateSeries = (svcSeries?.series ?? []).filter((s) => s.name === 'request.rate' && s.points?.length)
  const len = Math.min(...rateSeries.map((s) => s.points.length), 90)
  if (rateSeries.length > 0 && Number.isFinite(len) && len > 0) {
    const tsBase = rateSeries[0].points.slice(-len)
    for (let i = 0; i < len; i++) {
      let sum = 0
      for (const s of rateSeries) sum += s.points[s.points.length - len + i]?.value ?? 0
      trafficSpark.push({ ts: tsBase[i].ts, value: Math.round(sum) })
    }
  }

  // Host telemetry: prefer the real C agent (source=agent), fall back to the
  // gateway's simulated host series.
  const hostSeries = (hostAgent?.series?.length ? hostAgent : hostSim)?.series ?? []
  const host = {
    source: hostAgent?.series?.length ? 'agent' : 'simulated',
    cpu: sparkOf(hostSeries.find((s) => s.name === 'cpu.usage')),
    mem: sparkOf(hostSeries.find((s) => s.name === 'mem.used')),
    cpuNow: Math.round(latest(hostSeries.find((s) => s.name === 'cpu.usage')) * 10) / 10,
    memNow: Math.round(latest(hostSeries.find((s) => s.name === 'mem.used')) * 10) / 10,
  }

  return NextResponse.json({
    kpis: {
      totalRps,
      errorRate: Math.round(weightedErr * 100) / 100,
      p99: Math.round(weightedP99 * 10) / 10,
      agents: stats?.agents_connected ?? 0,
      activeSeries: stats?.series_active ?? 0,
      metricsIngested: stats?.metrics_ingested ?? 0,
      openIncidents: openIncidents.length,
      alertRules: ruleCount,
      overallStatus: insights?.summary?.overall_status ?? (dataUp ? 'healthy' : 'unknown'),
      engineWarm: insights?.summary?.engine_warm ?? false,
    },
    traffic: trafficSpark,
    services,
    host,
    insights: insights
      ? {
          anomalies: insights.anomalies.slice(0, 4),
          overall: insights.summary.overall_status,
        }
      : null,
    incidents: openIncidents.map((i) => ({
      id: i.id,
      serviceKey: i.serviceKey,
      title: i.title,
      severity: i.severity,
      status: i.status,
      startedAt: i.startedAt.toISOString(),
      assignee: i.assignee,
    })),
    meta: {
      gateway: dataUp,
      aiops: !!insights,
      tookMs: Date.now() - began,
      at: new Date().toISOString(),
    },
  })
}
