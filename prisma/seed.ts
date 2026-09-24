/**
 * Seed the Lodestar web tier with a realistic demo organisation.
 * Run: bun prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// Deterministic pseudo-random so seeds are stable across runs.
let seedState = 42
const rand = () => {
  seedState = (seedState * 1103515245 + 12345) % 2147483648
  return seedState / 2147483648
}

const SERVICES = [
  { key: 'api-gateway', name: 'API Gateway', tier: 'edge', owner: 'platform', language: 'go', sloTarget: 99.95 },
  { key: 'checkout-service', name: 'Checkout Service', tier: 'critical', owner: 'payments', language: 'java', sloTarget: 99.99 },
  { key: 'auth-service', name: 'Auth Service', tier: 'critical', owner: 'identity', language: 'go', sloTarget: 99.99 },
  { key: 'search-cluster', name: 'Search Cluster', tier: 'standard', owner: 'discovery', language: 'python', sloTarget: 99.5 },
  { key: 'billing-worker', name: 'Billing Worker', tier: 'standard', owner: 'payments', language: 'csharp', sloTarget: 99.9 },
  { key: 'edge-cdn', name: 'Edge CDN', tier: 'edge', owner: 'platform', language: 'c', sloTarget: 99.95 },
]

const RULES = [
  { serviceKey: 'checkout-service', metric: 'error.rate', comparator: 'above', threshold: 3, windowMinutes: 5, severity: 'critical' },
  { serviceKey: 'checkout-service', metric: 'latency.p99', comparator: 'above', threshold: 220, windowMinutes: 5, severity: 'warning' },
  { serviceKey: 'api-gateway', metric: 'error.rate', comparator: 'above', threshold: 1.5, windowMinutes: 5, severity: 'critical' },
  { serviceKey: 'auth-service', metric: 'latency.p99', comparator: 'above', threshold: 180, windowMinutes: 5, severity: 'warning' },
  { serviceKey: 'search-cluster', metric: 'latency.p99', comparator: 'above', threshold: 500, windowMinutes: 10, severity: 'info' },
  { serviceKey: 'billing-worker', metric: 'error.rate', comparator: 'above', threshold: 2, windowMinutes: 5, severity: 'warning' },
  { serviceKey: 'edge-cdn', metric: 'request.rate', comparator: 'below', threshold: 500, windowMinutes: 10, severity: 'warning' },
  { serviceKey: 'api-gateway', metric: 'cpu.usage', comparator: 'above', threshold: 85, windowMinutes: 10, severity: 'info' },
]

const TEAM = [
  { name: 'Amara Okafor', email: 'amara@lodestar.dev', role: 'owner', hue: 152, onCall: true },
  { name: 'Kenji Tanaka', email: 'kenji@lodestar.dev', role: 'sre', hue: 38, onCall: true },
  { name: 'Priya Sharma', email: 'priya@lodestar.dev', role: 'sre', hue: 348, onCall: false },
  { name: 'Diego Ramirez', email: 'diego@lodestar.dev', role: 'engineer', hue: 265, onCall: false },
  { name: 'Nadia Petrov', email: 'nadia@lodestar.dev', role: 'observer', hue: 200, onCall: false },
]

function daysAgo(n: number, hourOffset = 0): Date {
  return new Date(Date.now() - n * 86400000 - hourOffset * 3600000)
}

async function main() {
  console.log('seeding lodestar web tier...')

  await db.usageRecord.deleteMany()
  await db.apiKey.deleteMany()
  await db.teamMember.deleteMany()
  await db.incident.deleteMany()
  await db.alertRule.deleteMany()
  await db.service.deleteMany()

  for (const s of SERVICES) await db.service.create({ data: s })
  for (const r of RULES) await db.alertRule.create({ data: r })

  for (const t of TEAM) await db.teamMember.create({ data: t })

  await db.apiKey.create({ data: { name: 'Production ingest', prefix: 'pg_live_demo_key', env: 'production' } })
  await db.apiKey.create({ data: { name: 'Staging agents', prefix: 'pg_live_stg_9f2c', env: 'staging' } })
  await db.apiKey.create({ data: { name: 'Legacy load-test key', prefix: 'pg_test_old_4410', env: 'staging', revoked: true, lastUsedAt: daysAgo(9) } })

  // ---- incidents ---------------------------------------------------------
  const resolvedDowntime = await db.incident.create({
    data: {
      serviceKey: 'search-cluster',
      title: 'Elevated p99 latency during index rebuild',
      severity: 'warning',
      status: 'resolved',
      source: 'aiops',
      startedAt: daysAgo(2, 6),
      acknowledgedAt: daysAgo(2, 6.1),
      resolvedAt: daysAgo(2, 4.6),
      assignee: 'Priya Sharma',
      timeline: JSON.stringify([
        { ts: daysAgo(2, 6).toISOString(), event: 'triggered', detail: 'AIOps flagged latency.p99 at 612ms (baseline 96ms, 7.1 sigma)' },
        { ts: daysAgo(2, 6.1).toISOString(), event: 'acknowledged', detail: 'Priya Sharma acknowledged and joined the incident channel' },
        { ts: daysAgo(2, 5.4).toISOString(), event: 'mitigated', detail: 'Paused recurring index compaction job; latency recovering' },
        { ts: daysAgo(2, 4.6).toISOString(), event: 'resolved', detail: 'Root cause: oversized shard merge window. Cap raised for next run' },
      ]),
    },
  })
  await db.incident.create({
    data: {
      serviceKey: 'edge-cdn',
      title: 'PoP cache-hit ratio dip in eu-west',
      severity: 'info',
      status: 'resolved',
      source: 'manual',
      startedAt: daysAgo(5, 3),
      acknowledgedAt: daysAgo(5, 2.8),
      resolvedAt: daysAgo(5, 1),
      assignee: 'Diego Ramirez',
      timeline: JSON.stringify([
        { ts: daysAgo(5, 3).toISOString(), event: 'triggered', detail: 'Manual report from NOC: hit ratio 71% vs 94% SLO' },
        { ts: daysAgo(5, 1).toISOString(), event: 'resolved', detail: 'Upstream purge completed; ratios normalised' },
      ]),
    },
  })
  await db.incident.create({
    data: {
      serviceKey: 'checkout-service',
      title: 'Payment authorisation latency creeping up',
      severity: 'critical',
      status: 'acknowledged',
      source: 'aiops',
      startedAt: daysAgo(0, 1.2),
      acknowledgedAt: daysAgo(0, 1.0),
      assignee: 'Kenji Tanaka',
      timeline: JSON.stringify([
        { ts: daysAgo(0, 1.2).toISOString(), event: 'triggered', detail: 'AIOps: latency.p99 2.4x baseline; burn rate 8.2x fast threshold' },
        { ts: daysAgo(0, 1.0).toISOString(), event: 'acknowledged', detail: 'Kenji Tanaka investigating PSP connection pool saturation' },
      ]),
    },
  })
  console.log('incidents seeded:', 3, '(sample:', resolvedDowntime.id + ')')

  // ---- usage metering (30 days) -------------------------------------------
  const perMillion = { 'ingested.events': 520, 'ingested.gb': 210, 'aiops.insights': 90 }
  const bulk: {
    serviceKey: string
    day: string
    metricName: string
    quantity: number
    unit: string
  }[] = []
  const units: Record<string, string> = {
    'ingested.events': 'events',
    'ingested.gb': 'GB',
    'aiops.insights': 'insights',
  }
  for (let d = 29; d >= 0; d--) {
    const day = daysAgo(d).toISOString().slice(0, 10)
    for (const s of SERVICES) {
      const growth = 1 + (29 - d) * 0.012
      const events = Math.round((1.2e6 + rand() * 9e5) * growth)
      const gb = +(events / 1e6 * 1.9 + rand() * 0.6).toFixed(2)
      const insights = Math.round(180 + rand() * 140)
      for (const [metric, qty] of [['ingested.events', events], ['ingested.gb', gb], ['aiops.insights', insights]] as const) {
        bulk.push({ serviceKey: s.key, day, metricName: metric, quantity: qty, unit: units[metric] })
      }
    }
  }
  // perMillion retained for pricing parity with billing-core (Java) rates
  void perMillion
  await db.usageRecord.createMany({ data: bulk })
  console.log('usage records seeded:', bulk.length)

  console.log('seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
