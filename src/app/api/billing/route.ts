import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Plan catalog. Mirrors services/billing-core (Java) Plan enum - kept in
 * sync via docs/api-contracts.md change protocol.
 */
const PLANS = {
  STARTER: { monthlyBase: 99, includedEvents: 50_000_000, includedHosts: 10, perMillionOverage: 0.4, retentionDays: 14 },
  PRO: { monthlyBase: 999, includedEvents: 500_000_000, includedHosts: 100, perMillionOverage: 0.3, retentionDays: 90 },
  ENTERPRISE: { monthlyBase: 4999, includedEvents: 5_000_000_000, includedHosts: 1000, perMillionOverage: 0.2, retentionDays: 400 },
} as const

type PlanKey = keyof typeof PLANS

const PRICING: Record<string, { perMillion: number; label: string }> = {
  'ingested.events': { perMillion: 0.3, label: 'Ingested events' },
  'ingested.gb': { perMillion: 0.12, label: 'Ingested volume' },
  'aiops.insights': { perMillion: 0.9, label: 'AIOps insights' },
}

/**
 * GET /api/billing
 * Metered usage for the current period, plan allowances, projected invoice
 * and per-service usage split - the web-tier view of billing-core's ledger.
 */
export async function GET() {
  const records = await db.usageRecord.findMany({ orderBy: { day: 'asc' } })
  if (records.length === 0) {
    return NextResponse.json({ error: 'no usage data' }, { status: 404 })
  }

  const byMetric: Record<string, number> = {}
  const byService: Record<string, number> = {}
  const byDay: Record<string, number> = {}
  for (const r of records) {
    const cost = r.metricName === 'ingested.events'
      ? (r.quantity / 1e6) * PRICING[r.metricName].perMillion
      : r.metricName === 'ingested.gb'
        ? r.quantity * PRICING[r.metricName].perMillion
        : (r.quantity / 1e6) * PRICING[r.metricName].perMillion
    byMetric[r.metricName] = (byMetric[r.metricName] ?? 0) + r.quantity
    byService[r.serviceKey] = (byService[r.serviceKey] ?? 0) + cost
    byDay[r.day] = (byDay[r.day] ?? 0) + cost
  }

  const plan: PlanKey = 'PRO'
  const p = PLANS[plan]
  const totalEvents = byMetric['ingested.events'] ?? 0
  const overageEvents = Math.max(0, totalEvents - p.includedEvents)
  const usageCost =
    (totalEvents / 1e6) * PRICING['ingested.events'].perMillion +
    (byMetric['ingested.gb'] ?? 0) * PRICING['ingested.gb'].perMillion +
    ((byMetric['aiops.insights'] ?? 0) / 1e6) * PRICING['aiops.insights'].perMillion
  const projected = p.monthlyBase + Math.max(0, usageCost - p.monthlyBase * 0.4) + overageEvents / 1e6

  const days = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b))
  const services = Object.entries(byService)
    .map(([key, cost]) => ({ key, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => b.cost - a.cost)
  const totalServiceCost = services.reduce((a, s) => a + s.cost, 0) || 1

  return NextResponse.json({
    plan: { key: plan, ...p },
    usage: {
      periodStart: days[0]?.[0],
      periodEnd: days[days.length - 1]?.[0],
      events: Math.round(totalEvents),
      gb: Math.round((byMetric['ingested.gb'] ?? 0) * 10) / 10,
      insights: Math.round(byMetric['aiops.insights'] ?? 0),
      quotaPct: Math.round((totalEvents / p.includedEvents) * 1000) / 10,
    },
    invoice: {
      base: p.monthlyBase,
      metered: Math.round(usageCost * 100) / 100,
      overage: Math.round((overageEvents / 1e6) * 100) / 100,
      projected: Math.round(projected * 100) / 100,
      currency: 'USD',
    },
    dailyCost: days.map(([day, cost]) => ({ day, cost: Math.round(cost * 100) / 100 })),
    services: services.map((s) => ({
      ...s,
      share: Math.round((s.cost / totalServiceCost) * 1000) / 10,
    })),
  })
}
