/**
 * Server-side clients for the Lodestar data plane:
 *  - ingest-gateway (Go, :3100) - live series, logs, stats
 *  - aiops-engine   (Python, :3200) - anomalies, forecasts, health
 *
 * Every call is time-boxed; when an upstream is unavailable the API layer
 * falls back to deterministic simulation so the console stays usable
 * (documented in docs/api-contracts.md -> degradation protocol).
 */

export const GATEWAY_URL = process.env.LODESTAR_GATEWAY_URL ?? 'http://127.0.0.1:3100'
export const AIOPS_URL = process.env.LODESTAR_AIOPS_URL ?? 'http://127.0.0.1:3200'
export const BILLING_URL = process.env.LODESTAR_BILLING_URL ?? 'http://127.0.0.1:4100'
export const REPORTING_URL = process.env.LODESTAR_REPORTING_URL ?? 'http://127.0.0.1:4200'
export const API_KEY = process.env.LODESTAR_API_KEY ?? 'pg_live_demo_key'
const TIMEOUT_MS = 2500

async function fetchJson<T>(
  url: string,
  timeoutMs = TIMEOUT_MS,
  init: RequestInit = {},
): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'x-api-key': API_KEY, accept: 'application/json', ...init.headers },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface GatewaySeries {
  name: string
  tags?: Record<string, string>
  points: { ts: number; value: number }[]
}

export interface GatewayLog {
  level: string
  service: string
  message: string
  ts: number
}

export interface GatewayStats {
  uptime_seconds: number
  series_active: number
  metrics_ingested: number
  logs_ingested: number
  agents_connected: number
  requests_per_second: number
  goroutines: number
  heap_mb: number
}

export const gateway = {
  stats: () => fetchJson<GatewayStats>(`${GATEWAY_URL}/v1/stats`),
  metrics: (names: string, range: string, points: number, filters: Record<string, string> = {}) => {
    const q = new URLSearchParams({ names, range, points: String(points), ...filters })
    return fetchJson<{ series: GatewaySeries[] }>(`${GATEWAY_URL}/v1/query/metrics?${q}`)
  },
  logs: (limit: number, level: string, service: string, q: string) => {
    const query = new URLSearchParams({ limit: String(limit) })
    if (level) query.set('level', level)
    if (service) query.set('service', service)
    if (q) query.set('q', q)
    return fetchJson<{ logs: GatewayLog[]; total: number }>(`${GATEWAY_URL}/v1/logs?${query}`)
  },
}

export interface AiopsAnomaly {
  id: string
  service: string
  metric: string
  severity: string
  confidence: number
  score: number
  baseline: number
  observed: number
  message: string
  startedAt: string
  detectedAt: string
}

export interface AiopsInsights {
  anomalies: AiopsAnomaly[]
  forecasts: { series: string; service: string; points: { ts: number; value: number; lower: number; upper: number }[] }[]
  health: { service: string; score: number; status: string; notes: string[] }[]
  summary: {
    services_monitored: number
    open_anomalies: number
    overall_status: string
    engine_warm: boolean
    uptime_seconds: number
  }
}

export const aiops = {
  insights: () => fetchJson<AiopsInsights>(`${AIOPS_URL}/v1/insights`),
  health: () => fetchJson<{ status: string }>(`${AIOPS_URL}/v1/health`, 1500),
}

// Code-tier services (Java billing-core :4100, C# reporting :4200). They are
// deployment peers rather than the live data path, so probes use a shorter
// timeout and every consumer degrades gracefully when they are offline.
export const billing = {
  health: () => fetchJson<{ status: string; checks?: Record<string, boolean> }>(`${BILLING_URL}/v1/health`, 1500),
  usage: (orgId: string) =>
    fetchJson<BillingUsageCurrent>(`${BILLING_URL}/v1/usage/current?orgId=${encodeURIComponent(orgId)}`),
  quotas: (orgId: string) =>
    fetchJson<BillingQuotaRow[]>(`${BILLING_URL}/v1/quotas?orgId=${encodeURIComponent(orgId)}`),
}

export const reporting = {
  health: () => fetchJson<{ status: string; service: string }>(`${REPORTING_URL}/v1/health`, 1500),
  sla: (body: SlaReportRequest) =>
    fetchJson<SlaReport>(`${REPORTING_URL}/v1/reports/sla`, 4000, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  reports: async (serviceId: string, limit: number) => {
    const q = new URLSearchParams({ limit: String(limit) })
    if (serviceId) q.set('serviceId', serviceId)
    // The reporting plane returns a bare JSON array; normalize defensively.
    const raw = await fetchJson<unknown>(`${REPORTING_URL}/v1/reports?${q}`, 2500)
    if (!raw) return null
    const list = Array.isArray(raw)
      ? raw
      : ((raw as { reports?: unknown }).reports as unknown[] | undefined) ?? []
    return { reports: list as SlaReport[], count: list.length }
  },
}

/** POST /v1/reports/sla request body (Lodestar.Reporting.Models.SlaReportRequest). */
export interface SlaReportRequest {
  serviceId: string
  from: string // ISO-8601, inclusive
  to: string // ISO-8601, exclusive
  sloTarget?: number
}

export interface SlaReport {
  id: string
  serviceId: string
  from: string
  to: string
  sloTarget: number
  summary: {
    availabilityPct: number
    totalDowntime: number
    totalRequests: number
    failedRequests: number
    errorBudgetMinutes: number
    errorBudgetPctRemaining: number
    burnRate: number
  }
  daily: { date: string; uptimePct: number; requests: number; errors: number }[]
  incidents: {
    startedAt: string
    endedAt: string
    durationMinutes: number
    estimatedFailedRequests: number
    severity: 'critical' | 'major' | 'minor'
  }[]
  generatedAt: string
}

export interface BillingUsageCurrent {
  orgId: string
  plan: string
  periodStart: string
  periodEnd: string
  totals: { metricName: string; unit: string; total: number }[]
}

export interface BillingQuotaRow {
  orgId: string
  metricName: string
  softLimit: number
  hardLimit: number
  consumedThisPeriod: number
  periodStart: string
}

export interface PlaneHealth {
  gateway: boolean
  aiops: boolean
  billing: boolean
  reporting: boolean
}

export async function upstreamHealth(): Promise<PlaneHealth> {
  const [g, a, b, r] = await Promise.all([
    fetchJson<{ status: string }>(`${GATEWAY_URL}/v1/health`, 1200),
    aiops.health(),
    billing.health(),
    reporting.health(),
  ])
  return { gateway: !!g, aiops: !!a, billing: !!b, reporting: !!r }
}
