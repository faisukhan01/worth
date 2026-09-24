'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useConsole } from '@/store/console-store'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json() as Promise<T>
}

// ---- payload types ---------------------------------------------------------

export interface OverviewPayload {
  kpis: {
    totalRps: number
    errorRate: number
    p99: number
    agents: number
    activeSeries: number
    metricsIngested: number
    openIncidents: number
    alertRules: number
    overallStatus: string
    engineWarm: boolean
  }
  traffic: { ts: number; value: number }[]
  services: { key: string; requestRate: number; errorRate: number; p99: number; spark: number[] }[]
  host: { source: string; cpu: number[]; mem: number[]; cpuNow: number; memNow: number }
  insights: { anomalies: AiopsAnomaly[]; overall: string } | null
  incidents: OpenIncident[]
  meta: { gateway: boolean; aiops: boolean; tookMs: number; at: string }
}

export interface OpenIncident {
  id: string
  serviceKey: string
  title: string
  severity: string
  status: string
  source?: string
  startedAt: string
  assignee: string | null
  dedupKey?: string | null
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
  detectedAt?: string
  active?: boolean
}

export interface AiopsPayload {
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

export interface ServiceRow {
  key: string
  name: string
  tier: string
  owner: string
  language: string
  sloTarget: number
  status: string
  requestRate: number
  errorRate: number
  p99: number
  p99Avg: number
  spark: number[]
  uptime30: number
  ribbon: number[]
}

export interface LogsPayload {
  logs: { level: string; service: string; message: string; ts: number }[]
  total: number
  source: string
}

export interface AlertsPayload {
  rules: {
    id: string
    serviceKey: string
    metric: string
    comparator: string
    threshold: number
    windowMinutes: number
    severity: string
    enabled: boolean
  }[]
  incidents: (OpenIncident & { timeline: string })[]
  counts: Record<string, number>
}

export interface BillingPayload {
  plan: { key: string; monthlyBase: number; includedEvents: number; includedHosts: number; perMillionOverage: number; retentionDays: number }
  plane?: {
    connected: boolean
    orgId?: string
    plan?: string
    periodStart?: string
    periodEnd?: string
    totals?: { metricName: string; unit: string; total: number }[]
    quotas?: { metricName: string; consumed: number; softLimit: number; hardLimit: number; percentUsed: number; state: string }[]
  }
  usage: { periodStart: string; periodEnd: string; events: number; gb: number; insights: number; quotaPct: number }
  invoice: { base: number; metered: number; overage: number; projected: number; currency: string }
  dailyCost: { day: string; cost: number }[]
  services: { key: string; cost: number; share: number }[]
}

export interface SettingsPayload {
  team: { id: string; name: string; email: string; role: string; hue: number; onCall: boolean }[]
  services: { key: string; name: string; owner: string; tier: string }[]
  platform: Record<string, string>
}

export interface MetricsPayload {
  series: { name: string; tags?: Record<string, string>; points: { ts: number; value: number }[] }[]
  meta: Record<string, unknown>
}

// ---- polling hooks ----------------------------------------------------------

const SLOW = 15_000
const FAST = 5_000

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => getJson<OverviewPayload>('/api/overview'),
    refetchInterval: FAST,
    placeholderData: (prev) => prev,
  })
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => getJson<{ services: ServiceRow[]; meta: { gateway: boolean } }>('/api/services'),
    refetchInterval: FAST,
    placeholderData: (prev) => prev,
  })
}

export function useMetrics(names: string, service: string, source: string) {
  const range = useConsole((s) => s.range)
  const params = new URLSearchParams({ names, range, points: '140' })
  if (service) params.set('service', service)
  if (source) params.set('source', source)
  return useQuery({
    queryKey: ['metrics', names, range, service, source],
    queryFn: () => getJson<MetricsPayload>(`/api/metrics?${params}`),
    refetchInterval: FAST,
    placeholderData: (prev) => prev,
  })
}

export function useLogs() {
  const { logLevel, logService, logQuery, paused } = useConsole()
  const params = new URLSearchParams({ limit: '300' })
  if (logLevel) params.set('level', logLevel)
  if (logService) params.set('service', logService)
  if (logQuery) params.set('q', logQuery)
  return useQuery({
    queryKey: ['logs', logLevel, logService, logQuery],
    queryFn: () => getJson<LogsPayload>(`/api/logs?${params}`),
    refetchInterval: paused ? false : FAST,
    placeholderData: (prev) => prev,
  })
}

export function useAiops() {
  return useQuery({
    queryKey: ['aiops'],
    queryFn: () => getJson<AiopsPayload>('/api/aiops'),
    refetchInterval: SLOW,
    placeholderData: (prev) => prev,
  })
}

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: () => getJson<AlertsPayload>('/api/alerts'),
    refetchInterval: SLOW,
    placeholderData: (prev) => prev,
  })
}

export function useBilling() {
  return useQuery({
    queryKey: ['billing'],
    queryFn: () => getJson<BillingPayload>('/api/billing'),
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  })
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => getJson<SettingsPayload>('/api/settings'),
    refetchInterval: SLOW,
    placeholderData: (prev) => prev,
  })
}

// ---- SLA reports (C# reporting plane) ---------------------------------------

export interface SlaReportPayload {
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
    severity: string
  }[]
  generatedAt: string
}

export function useReports(serviceId: string) {
  const params = new URLSearchParams({ limit: '12' })
  if (serviceId) params.set('serviceId', serviceId)
  return useQuery({
    queryKey: ['reports', serviceId],
    queryFn: () => getJson<{ reports: SlaReportPayload[]; count: number }>(`/api/reports?${params}`),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
    retry: 0,
  })
}

export function useGenerateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (req: { serviceId: string; windowDays: number; sloTarget: number }) => {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(req),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      return body as SlaReportPayload
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['reports'] }),
  })
}

export function useIncidentAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'acknowledge' | 'mitigate' | 'resolve' }) => {
      const res = await fetch(`/api/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

/** Assign / unassign an on-call engineer on a single incident. */
export function useAssignIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, assignee }: { id: string; assignee: string | null }) => {
      const res = await fetch(`/api/incidents/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignee }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export interface BulkIncidentResult {
  updated: number
  results: { id: string; ok: boolean; error?: string }[]
}

/** Bulk lifecycle transition and/or assignment over up to 50 incidents. */
export function useBulkIncidentAction() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      ids: string[]
      action?: 'acknowledge' | 'mitigate' | 'resolve'
      assignee?: string | null
    }) => {
      const res = await fetch('/api/incidents/bulk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return (await res.json()) as BulkIncidentResult
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function usePromoteIncident() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (anomaly: {
      service: string
      metric: string
      severity: string
      message: string
      baseline: number
      observed: number
    }) => {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceKey: anomaly.service,
          title: `${anomaly.metric} ${anomaly.observed >= anomaly.baseline ? 'spike' : 'drop'} detected by AIOps`,
          severity: anomaly.severity,
          detail: anomaly.message,
          source: 'aiops',
          // stable across anomaly-id rotations: one open incident per service+metric
          dedupKey: `${anomaly.service}:${anomaly.metric}`,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return res.json() as Promise<{ deduplicated: boolean }>
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts'] })
      void qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useCreateRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (rule: {
      serviceKey: string
      metric: string
      comparator: string
      threshold: number
      windowMinutes: number
      severity: string
    }) => {
      const res = await fetch('/api/alerts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rule),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alerts'] }),
  })
}

export interface RuleEvaluation {
  serviceKey: string
  metric: string
  comparator: string
  threshold: number
  windowMinutes: number
  severity: string
  currentValue: number | null
  sampleCount: number
  evaluable: boolean
  wouldFire: boolean
  reason: string
  evaluatedAt: string
}

export interface RuleTestResult {
  evaluation: RuleEvaluation
  ruleId?: string | null
  drill?: { id: string; deduplicated: boolean; title: string }
}

/**
 * Test-fire an alert rule against live gateway telemetry (evaluate) or
 * register a drill incident (drill mode).
 */
export function useTestRule() {
  return useMutation({
    mutationFn: async (
      payload:
        | { ruleId: string; mode?: 'evaluate' | 'drill' }
        | {
            serviceKey: string
            metric: string
            comparator: string
            threshold: number
            windowMinutes: number
            severity: string
            mode?: 'evaluate' | 'drill'
          },
    ) => {
      const res = await fetch('/api/alerts/rules/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `request failed (${res.status})`)
      }
      return (await res.json()) as RuleTestResult
    },
  })
}
