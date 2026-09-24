import { db } from '@/lib/db'
import { reporting, type SlaReport } from '@/lib/upstream'

// ---------------------------------------------------------------------------
// Lodestar report drift watch
//
// A background loop snapshots every catalogued service's 7-day SLA through
// the C# reporting plane (:4200), persists the numbers locally and compares
// each snapshot with the previous one. When availability or burn rate drifts
// beyond the thresholds a real incident is registered (source=report-drift,
// dedupKey drift:<service>) and auto-resolves once the drift settles while
// the incident is still untouched - the same lifecycle the rule evaluator
// uses, so humans only ever see actionable drift.
//
// Storage uses raw SQL (report_snapshots table) so the running dev server
// does not depend on a regenerated Prisma client.
// ---------------------------------------------------------------------------

const DRIFT_AVAIL_PP = 0.05 // percentage points of availability change
const DRIFT_BURN = 0.75 // absolute burn-rate change
const CRIT_AVAIL_PP = 0.2
const CRIT_BURN = 2
const SNAPSHOT_WINDOW_DAYS = 7
const KEEP_PER_SERVICE = 48

export interface DriftSnapshot {
  id: string
  service: string
  takenAt: string
  windowDays: number
  sloTarget: number
  availability: number
  burnRate: number
  budgetRemaining: number
  reportId: string
}

export interface DriftDiff {
  prevTakenAt: string
  availabilityDelta: number
  burnDelta: number
  drift: boolean
  severity: 'warning' | 'critical'
}

export interface CycleEntry {
  service: string
  snapshot: DriftSnapshot | null
  diff: DriftDiff | null
  incidentId?: string
  incidentAction?: 'fired' | 'deduped' | 'auto-resolved'
  error?: string
}

export interface DriftCycle {
  at: string
  durationMs: number
  taken: number
  drifts: number
  results: CycleEntry[]
}

interface DriftGlobal {
  __lodestarLastDriftCycle?: DriftCycle | null
  __lodestarDriftInProgress?: boolean
  __lodestarDriftLoop?: ReturnType<typeof setInterval> | null
  __lodestarSnapshotsTable?: boolean
}

const g = globalThis as typeof globalThis & DriftGlobal
g.__lodestarLastDriftCycle ??= null
g.__lodestarDriftInProgress = false
g.__lodestarDriftLoop ??= null

function ensureTable(): void {
  if (g.__lodestarSnapshotsTable) return
  db.$executeRaw`
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      taken_at TEXT NOT NULL,
      window_days INTEGER NOT NULL,
      slo_target REAL NOT NULL,
      availability REAL NOT NULL,
      burn_rate REAL NOT NULL,
      budget_remaining REAL NOT NULL,
      report_id TEXT NOT NULL
    )
  `
    .then(() =>
      db.$executeRaw`CREATE INDEX IF NOT EXISTS idx_snapshots_service_taken ON report_snapshots (service, taken_at)`,
    )
    .catch(() => {})
  g.__lodestarSnapshotsTable = true
}

/** Services currently in the catalog (falls back to the seed set). */
async function watchedServices(): Promise<string[]> {
  try {
    const rows = await db.$queryRaw<{ key: string }[]>`SELECT key FROM Service ORDER BY key`
    if (rows.length > 0) return rows.map((r) => r.key)
  } catch {
    // fall through
  }
  return ['api-gateway', 'auth-service', 'billing-worker', 'checkout-service', 'edge-cdn', 'search-cluster']
}

async function prevSnapshot(service: string): Promise<DriftSnapshot | null> {
  const rows = await db.$queryRaw<
    { id: string; service: string; takenAt: string; windowDays: number; sloTarget: number; availability: number; burnRate: number; budgetRemaining: number; reportId: string }[]
  >`SELECT id, service, taken_at AS takenAt, window_days AS windowDays, slo_target AS sloTarget,
           availability, burn_rate AS burnRate, budget_remaining AS budgetRemaining, report_id AS reportId
    FROM report_snapshots WHERE service = ${service} ORDER BY taken_at DESC LIMIT 1`
  return rows[0] ?? null
}

async function saveSnapshot(s: DriftSnapshot): Promise<void> {
  await db.$executeRaw`
    INSERT INTO report_snapshots (id, service, taken_at, window_days, slo_target, availability, burn_rate, budget_remaining, report_id)
    VALUES (${s.id}, ${s.service}, ${s.takenAt}, ${s.windowDays}, ${s.sloTarget}, ${s.availability}, ${s.burnRate}, ${s.budgetRemaining}, ${s.reportId})
  `
  await db
    .$executeRaw`DELETE FROM report_snapshots WHERE service = ${s.service} AND id NOT IN (
      SELECT id FROM report_snapshots WHERE service = ${s.service} ORDER BY taken_at DESC LIMIT ${KEEP_PER_SERVICE}
    )`
    .catch(() => {})
}

function diffAgainst(prev: DriftSnapshot | null, snap: DriftSnapshot): DriftDiff | null {
  if (!prev) return null
  const availabilityDelta = Math.round((snap.availability - prev.availability) * 1000) / 1000
  const burnDelta = Math.round((snap.burnRate - prev.burnRate) * 1000) / 1000
  const drift = Math.abs(availabilityDelta) >= DRIFT_AVAIL_PP || Math.abs(burnDelta) >= DRIFT_BURN
  const severity: 'warning' | 'critical' =
    Math.abs(availabilityDelta) >= CRIT_AVAIL_PP || Math.abs(burnDelta) >= CRIT_BURN ? 'critical' : 'warning'
  return { prevTakenAt: prev.takenAt, availabilityDelta, burnDelta, drift, severity }
}

function driftDetail(service: string, d: DriftDiff, snap: DriftSnapshot): string {
  const dir = (v: number) => (v > 0 ? '+' : '')
  return (
    `availability ${snap.availability.toFixed(3)}% (${dir(d.availabilityDelta)}${d.availabilityDelta}pp) · ` +
    `burn ×${snap.burnRate.toFixed(2)} (${dir(d.burnDelta)}${d.burnDelta}) vs snapshot ` +
    `${d.prevTakenAt.slice(0, 16).replace('T', ' ')}Z · thresholds ±${DRIFT_AVAIL_PP}pp / ±${DRIFT_BURN}× burn`
  )
}

/** Take one snapshot for a service and reconcile its drift incident. */
async function snapshotService(service: string, sloTarget?: number): Promise<CycleEntry> {
  const to = new Date()
  const from = new Date(to.getTime() - SNAPSHOT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  let report: SlaReport | null = null
  try {
    report = await reporting.sla({
      serviceId: service,
      from: from.toISOString(),
      to: to.toISOString(),
      ...(sloTarget !== undefined ? { sloTarget } : {}),
    })
  } catch {
    report = null
  }
  if (!report) {
    return { service, snapshot: null, diff: null, error: 'reporting plane unavailable or rejected the snapshot' }
  }

  // Read the previous snapshot BEFORE persisting the new one, otherwise the
  // "previous" lookup would just find the row we are about to insert.
  const previous = await prevSnapshot(service).catch(() => null)

  const snap: DriftSnapshot = {
    id: report.id,
    service,
    takenAt: to.toISOString(),
    windowDays: SNAPSHOT_WINDOW_DAYS,
    sloTarget: report.sloTarget,
    availability: report.summary.availabilityPct,
    burnRate: report.summary.burnRate,
    budgetRemaining: report.summary.errorBudgetPctRemaining,
    reportId: report.id,
  }
  await saveSnapshot(snap)

  const diff = diffAgainst(previous, snap)

  const entry: CycleEntry = { service, snapshot: snap, diff }

  if (!diff?.drift) {
    // Settled: auto-resolve an untouched drift incident for this service.
    const open = await db.incident
      .findFirst({ where: { dedupKey: `drift:${service}`, status: { not: 'resolved' } }, orderBy: { startedAt: 'desc' } })
      .catch(() => null)
    if (open && open.status === 'triggered') {
      const now = new Date()
      const timeline: { ts: string; event: string; detail: string }[] = JSON.parse(open.timeline || '[]')
      timeline.push({
        ts: now.toISOString(),
        event: 'resolved',
        detail: `auto-resolved · drift settled: availability ${snap.availability.toFixed(3)}% · burn ×${snap.burnRate.toFixed(2)}`,
      })
      await db.incident
        .update({
          where: { id: open.id },
          data: { status: 'resolved', resolvedAt: now, timeline: JSON.stringify(timeline) },
        })
        .catch(() => {})
      entry.incidentId = open.id
      entry.incidentAction = 'auto-resolved'
    }
    return entry
  }

  // Drifted - dedupe while an incident is already open.
  const open = await db.incident
    .findFirst({ where: { dedupKey: `drift:${service}`, status: { not: 'resolved' } }, orderBy: { startedAt: 'desc' } })
    .catch(() => null)
  if (open) {
    entry.incidentId = open.id
    entry.incidentAction = 'deduped'
    return entry
  }
  const now = new Date()
  const severity = diff.severity
  const incident = await db.incident
    .create({
      data: {
        serviceKey: service,
        title: `[drift] SLA drift on ${service}`,
        severity,
        status: 'triggered',
        source: 'report-drift',
        dedupKey: `drift:${service}`,
        startedAt: now,
        timeline: JSON.stringify([
          {
            ts: now.toISOString(),
            event: 'triggered',
            detail: `drift watch · ${driftDetail(service, diff, snap)}`,
          },
        ]),
      },
    })
    .catch(() => null)
  if (incident) {
    entry.incidentId = incident.id
    entry.incidentAction = 'fired'
  }
  return entry
}

/** Snapshot every watched service, diff and reconcile incidents. */
export async function runDriftCycle(onlyService?: string): Promise<DriftCycle> {
  if (g.__lodestarDriftInProgress) {
    return lastDriftCycle() ?? {
      at: new Date().toISOString(), durationMs: 0, taken: 0, drifts: 0, results: [],
    }
  }
  g.__lodestarDriftInProgress = true
  ensureTable()
  const started = Date.now()
  try {
    const targets = onlyService ? [onlyService] : await watchedServices()
    const results: CycleEntry[] = []
    for (const service of targets) {
      try {
        results.push(await snapshotService(service))
      } catch (err) {
        results.push({ service, snapshot: null, diff: null, error: err instanceof Error ? err.message : 'snapshot failed' })
      }
    }
    const cycle: DriftCycle = {
      at: new Date().toISOString(),
      durationMs: Date.now() - started,
      taken: results.filter((r) => r.snapshot).length,
      drifts: results.filter((r) => r.diff?.drift).length,
      results,
    }
    // Only full (all-service) cycles update the status strip; per-service
    // snapshot requests are visible in their row history instead.
    if (!onlyService) g.__lodestarLastDriftCycle = cycle
    return cycle
  } finally {
    g.__lodestarDriftInProgress = false
  }
}

export function lastDriftCycle(): DriftCycle | null {
  return g.__lodestarLastDriftCycle ?? null
}

export function driftInProgress(): boolean {
  return Boolean(g.__lodestarDriftInProgress)
}

export interface SnapshotList {
  watched: string[]
  snapshots: Record<string, DriftSnapshot[]>
}

/** Snapshot history grouped per service (oldest -> newest). */
export async function listSnapshots(limitPerService = 24): Promise<SnapshotList> {
  ensureTable()
  const watched = await watchedServices()
  const rows = await db.$queryRaw<
    { id: string; service: string; takenAt: string; windowDays: number; sloTarget: number; availability: number; burnRate: number; budgetRemaining: number; reportId: string }[]
  >`SELECT id, service, taken_at AS takenAt, window_days AS windowDays, slo_target AS sloTarget,
           availability, burn_rate AS burnRate, budget_remaining AS budgetRemaining, report_id AS reportId
    FROM report_snapshots ORDER BY taken_at DESC LIMIT ${Math.max(limitPerService, 1) * Math.max(watched.length, 1)}`
  const snapshots: Record<string, DriftSnapshot[]> = {}
  for (const key of watched) snapshots[key] = []
  for (const r of rows) {
    const list = snapshots[r.service] ?? (snapshots[r.service] = [])
    if (list.length < limitPerService) {
      list.push({ ...r, takenAt: new Date(r.takenAt).toISOString() })
    }
  }
  for (const key of Object.keys(snapshots)) snapshots[key].reverse()
  return { watched, snapshots }
}

/** Sweep-on-read style nudge so the loop also runs where hooks never boot. */
export function maybeDriftCycle(minIntervalMs = 180_000): void {
  if (g.__lodestarDriftInProgress) return
  const last = g.__lodestarLastDriftCycle
  if (last && Date.now() - new Date(last.at).getTime() < minIntervalMs) return
  void runDriftCycle().catch(() => {})
}

/** Background loop started from instrumentation.ts (3-minute cadence). */
export function startDriftLoop(intervalMs = 180_000): void {
  if (g.__lodestarDriftLoop) return
  const first = setTimeout(() => {
    void runDriftCycle().catch(() => {})
  }, 45_000)
  first.unref?.()
  g.__lodestarDriftLoop = setInterval(() => {
    void runDriftCycle().catch(() => {})
  }, intervalMs)
  if (typeof g.__lodestarDriftLoop.unref === 'function') g.__lodestarDriftLoop.unref()
}
