'use client'

import { useEffect, useRef, useState } from 'react'
import { useAlerts, useIncidentAction, useCreateRule, useTestRule, useBulkIncidentAction, useAssignIncident, useSettings, useActivity, type OpenIncident } from '@/hooks/use-console-data'
import { StatusPill, EmptyState, TONE_COLOR, statusTone, SectionHeader } from '@/components/console/primitives'
import { timeAgo } from '@/lib/format'
import { useIncidentFilterPresets, type IncidentFilterPreset } from '@/lib/incident-filter-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { BellRing, Crosshair, FlaskConical, Gauge, Plus, ShieldCheck, Siren, Timer, UserPlus, Filter, Pin, PinOff, History } from 'lucide-react'

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

interface IncidentFilters {
  status: string
  severity: string
  service: string
  assignee: string
}

const NO_FILTERS: IncidentFilters = { status: '', severity: '', service: '', assignee: '' }

function filtersActive(f: IncidentFilters): boolean {
  return Boolean(f.status || f.severity || f.service || f.assignee)
}

function filterLabel(f: IncidentFilters): string {
  const parts: string[] = []
  if (f.status) parts.push(`status:${f.status}`)
  if (f.severity) parts.push(`sev:${f.severity}`)
  if (f.service) parts.push(f.service)
  if (f.assignee === '__none') parts.push('unassigned')
  else if (f.assignee) parts.push(`@${f.assignee.split(' ')[0].toLowerCase()}`)
  return parts.join(' · ') || 'empty'
}

const EVENT_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'neutral'> = {
  triggered: 'crit',
  acknowledged: 'warn',
  mitigated: 'neutral',
  resolved: 'ok',
  assignment: 'neutral',
}

export function AlertsView() {
  const { data, isLoading } = useAlerts()
  const { data: settings } = useSettings()
  const incidentAction = useIncidentAction()
  const testRule = useTestRule()
  const bulk = useBulkIncidentAction()
  const assignIncident = useAssignIncident()
  const [selected, setSelected] = useState<OpenIncident | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [assignPick, setAssignPick] = useState('')
  const [filters, setFilters] = useState<IncidentFilters>(NO_FILTERS)
  const [presets, savePreset, removePreset] = useIncidentFilterPresets()
  const [activityEvent, setActivityEvent] = useState('')
  const activity = useActivity('', activityEvent)
  const [tab, setTab] = useState('incidents')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Deep-link: once the register has rendered the focused incident, scroll it
  // into view and flash it so the eye can find the row instantly.
  useEffect(() => {
    if (!focusId) return
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-incident-id="${focusId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFlashId(focusId)
        flashTimer.current = setTimeout(() => setFlashId(null), 2600)
      }
    }, 80)
    return () => {
      clearTimeout(t)
      if (flashTimer.current) clearTimeout(flashTimer.current)
    }
  }, [focusId])

  /** Jump from an Activity row to the incident: incidents tab, filters reset,
   *  card expanded and flashed. */
  const jumpToIncident = (incidentId: string) => {
    const inc = data?.incidents.find((i) => i.id === incidentId)
    setFilters(NO_FILTERS)
    setTab('incidents')
    setFocusId(incidentId)
    if (inc) setSelected(inc as OpenIncident)
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (!data) return <EmptyState title="Alert register unavailable" />

  const matches = (i: OpenIncident) =>
    (!filters.status || i.status === filters.status) &&
    (!filters.severity || i.severity === filters.severity) &&
    (!filters.service || i.serviceKey === filters.service) &&
    (!filters.assignee || (filters.assignee === '__none' ? !i.assignee : i.assignee === filters.assignee))

  const open = data.incidents.filter((i) => i.status !== 'resolved' && matches(i))
  const resolved = data.incidents.filter((i) => i.status === 'resolved' && matches(i))
  // Deep-linked resolved incidents must be visible even beyond the usual 6-row tail.
  const resolvedShown = focusId && resolved.some((r) => r.id === focusId) ? resolved : resolved.slice(0, 6)

  const act = (id: string, action: 'acknowledge' | 'mitigate' | 'resolve') => {
    incidentAction.mutate(
      { id, action },
      {
        onSuccess: () => toast.success(`Incident ${action}d`, { description: 'Timeline updated in the register.' }),
        onError: (e: Error) => toast.error('Transition rejected', { description: e.message }),
      },
    )
    if (selected?.id === id) setSelected(null)
  }

  /** Evaluate a saved rule, then offer a one-click drill from the toast. */
  const testSavedRule = (rule: { id: string; serviceKey: string; metric: string; comparator: string; threshold: number; severity: string }) => {
    testRule.mutate(
      { ruleId: rule.id },
      {
        onSuccess: (result) => {
          const e = result.evaluation
          if (!e.evaluable) {
            toast.warning('Rule could not be evaluated', { description: e.reason })
            return
          }
          const verdict = e.wouldFire ? 'WOULD FIRE' : 'would not fire'
          toast(`Test: ${verdict}`, {
            duration: 10_000,
            description: `${rule.metric} on ${rule.serviceKey} · current ${e.currentValue} vs ${rule.comparator} ${rule.threshold}`,
            ...(e.wouldFire
              ? {
                  action: {
                    label: 'Fire drill',
                    onClick: () => fireDrill(rule.id),
                  },
                }
              : {}),
          })
        },
        onError: (err: Error) => toast.error('Test failed', { description: err.message }),
      },
    )
  }

  const fireDrill = (ruleId: string) => {
    testRule.mutate(
      { ruleId, mode: 'drill' },
      {
        onSuccess: (result) => {
          if (result.drill?.deduplicated) {
            toast.info('Drill already open', { description: 'Resolve the existing drill incident before re-firing.' })
          } else {
            toast.success('Drill incident registered', { description: 'Find it under Incidents tagged DRILL.' })
          }
        },
        onError: (err: Error) => toast.error('Drill rejected', { description: err.message }),
      },
    )
  }

  const team = settings?.team ?? []

  const openIds = data.incidents.filter((i) => i.status !== 'resolved' && matches(i)).map((i) => i.id)
  const allChecked = openIds.length > 0 && openIds.every((id) => checked.has(id))

  const assigneeKeys = [...new Set(data.incidents.map((i) => i.assignee).filter((a): a is string => Boolean(a)))].sort()
  const serviceKeys = [...new Set(data.incidents.map((i) => i.serviceKey))].sort()

  const toggleRow = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setChecked(allChecked ? new Set() : new Set(openIds))
  }

  const summarize = (r: { updated: number; results: { ok: boolean }[] }, verb: string) => {
    const skipped = r.results.length - r.updated
    if (r.updated === 0) {
      toast.info(`Nothing ${verb}`, { description: `${skipped} incident(s) were not in a state for that transition.` })
    } else {
      toast.success(`${verb} ${r.updated} incident(s)`, { description: skipped > 0 ? `${skipped} skipped (state conflict or missing).` : 'Register refreshed.' })
    }
  }

  const bulkAct = (action: 'acknowledge' | 'mitigate' | 'resolve') => {
    bulk.mutate(
      { ids: [...checked], action },
      {
        onSuccess: (r) => {
          summarize(r, action === 'acknowledge' ? 'Acknowledged' : action === 'mitigate' ? 'Mitigated' : 'Resolved')
          setChecked(new Set())
        },
        onError: (e: Error) => toast.error('Bulk action failed', { description: e.message }),
      },
    )
  }

  const bulkAssign = (name: string | null) => {
    bulk.mutate(
      { ids: [...checked], assignee: name },
      {
        onSuccess: (r) => {
          summarize(r, name ? `Assigned to ${name}` : 'Unassigned')
          setChecked(new Set())
        },
        onError: (e: Error) => toast.error('Bulk assignment failed', { description: e.message }),
      },
    )
  }

  const assignOne = (id: string, name: string | null) => {
    assignIncident.mutate(
      { id, assignee: name },
      {
        onSuccess: () => toast.success(name ? `Assigned to ${name}` : 'Unassigned'),
        onError: (e: Error) => toast.error('Assignment rejected', { description: e.message }),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Alerts & incidents</h1>
          <p className="text-xs text-muted-foreground">
            {data.counts.open} open · {data.counts.rulesEnabled}/{data.counts.rules} rules armed
            {filtersActive(filters) && (
              <>
                {' '}· <span className="text-foreground/80">{open.length} match filter</span>
              </>
            )}
          </p>
        </div>
        <NewRuleDialog />
      </div>

      {/* Summary strip - counts follow the active filter */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Siren className="h-3.5 w-3.5" />} label="Triggered" value={data.counts.triggered} filteredValue={filtersActive(filters) ? data.incidents.filter((i) => i.status === 'triggered' && matches(i)).length : undefined} tone="crit" />
        <StatCard icon={<BellRing className="h-3.5 w-3.5" />} label="Acknowledged" value={data.counts.acknowledged} filteredValue={filtersActive(filters) ? data.incidents.filter((i) => i.status === 'acknowledged' && matches(i)).length : undefined} tone="warn" />
        <StatCard icon={<Timer className="h-3.5 w-3.5" />} label="Mitigated" value={data.counts.mitigated} filteredValue={filtersActive(filters) ? data.incidents.filter((i) => i.status === 'mitigated' && matches(i)).length : undefined} tone="neutral" />
        <StatCard icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Resolved (register)" value={data.counts.resolved} filteredValue={filtersActive(filters) ? data.incidents.filter((i) => i.status === 'resolved' && matches(i)).length : undefined} tone="ok" />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8">
          <TabsTrigger value="incidents" className="text-xs">Incidents</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">Rules</TabsTrigger>
          <TabsTrigger value="activity" className="gap-1 text-xs">
            <History className="h-3 w-3" /> Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="mt-3 space-y-2">
          {/* Saved-filter chip row */}
          {(presets.length > 0 || filtersActive(filters)) && (
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              {presets.map((p) => {
                const active = filterLabel(filters) === filterLabel({ status: p.status, severity: p.severity, service: p.service, assignee: p.assignee })
                return (
                  <span
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFilters({ status: p.status, severity: p.severity, service: p.service, assignee: p.assignee })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setFilters({ status: p.status, severity: p.severity, service: p.service, assignee: p.assignee })
                      }
                    }}
                    className={cn(
                      'group inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] transition-colors',
                      active
                        ? 'border-primary/50 bg-primary/15 text-foreground'
                        : 'bg-muted/40 text-muted-foreground hover:border-ring/50 hover:text-foreground',
                    )}
                  >
                    <Filter className="h-2.5 w-2.5" />
                    {p.label}
                    <button
                      aria-label={`Remove preset ${p.label}`}
                      className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); removePreset(p.id) }}
                    >
                      <PinOff className="h-2.5 w-2.5" />
                    </button>
                  </span>
                )
              })}
              {filtersActive(filters) && (
                <button
                  className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => setFilters(NO_FILTERS)}
                >
                  clear
                </button>
              )}
            </div>
          )}

          {/* Filter bar */}
          <div className="card-surface flex flex-wrap items-center gap-2 px-3 py-2">
            <Filter className="h-3 w-3 shrink-0 text-muted-foreground" />
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v === '__all' ? '' : v })}>
              <SelectTrigger className="h-7 w-[7.5rem] text-[11px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all" className="text-xs">any status</SelectItem>
                {['triggered', 'acknowledged', 'mitigated', 'resolved'].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.severity} onValueChange={(v) => setFilters({ ...filters, severity: v === '__all' ? '' : v })}>
              <SelectTrigger className="h-7 w-[7.5rem] text-[11px]"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all" className="text-xs">any severity</SelectItem>
                {['critical', 'warning', 'info'].map((s) => (
                  <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.service} onValueChange={(v) => setFilters({ ...filters, service: v === '__all' ? '' : v })}>
              <SelectTrigger className="h-7 w-40 font-mono text-[11px]"><SelectValue placeholder="Service" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all" className="text-xs">any service</SelectItem>
                {serviceKeys.map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.assignee} onValueChange={(v) => setFilters({ ...filters, assignee: v === '__all' ? '' : v })}>
              <SelectTrigger className="h-7 w-40 text-[11px]"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all" className="text-xs">any assignee</SelectItem>
                {assigneeKeys.map((a) => (
                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                ))}
                <SelectItem value="__none" className="text-xs text-muted-foreground">unassigned</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 gap-1 px-2 text-[11px] text-muted-foreground"
              disabled={!filtersActive(filters)}
              onClick={() => {
                const preset: IncidentFilterPreset = {
                  id: `f${Date.now().toString(36)}`,
                  label: filterLabel(filters),
                  status: filters.status,
                  severity: filters.severity,
                  service: filters.service,
                  assignee: filters.assignee,
                }
                savePreset(preset)
                toast.success('Filter pinned', { description: `“${preset.label}” is now one click away.` })
              }}
            >
              <Pin className="h-3 w-3" /> Pin filter
            </Button>
          </div>

          {/* Selection + bulk action bar */}
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Checkbox
              checked={allChecked}
              onCheckedChange={toggleAll}
              disabled={openIds.length === 0}
              aria-label="Select all open incidents"
            />
            <span className="text-[11px] text-muted-foreground">
              {checked.size > 0 ? `${checked.size} selected` : `${openIds.length} open · select for bulk actions`}
            </span>
            {checked.size > 0 && (
              <div className="rise-in ml-auto flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={bulk.isPending} onClick={() => bulkAct('acknowledge')}>
                  Ack
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={bulk.isPending} onClick={() => bulkAct('mitigate')}>
                  Mitigate
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-[11px] text-ok hover:text-ok" disabled={bulk.isPending} onClick={() => bulkAct('resolve')}>
                  Resolve
                </Button>
                <Select value={assignPick} onValueChange={(v) => { setAssignPick(''); bulkAssign(v === '__none' ? null : v) }} disabled={bulk.isPending}>
                  <SelectTrigger className="h-7 w-40 gap-1 text-[11px]" aria-label="Bulk assign to team member">
                    <UserPlus className="h-3 w-3 text-muted-foreground" />
                    <SelectValue placeholder="Assign to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {team.map((m) => (
                      <SelectItem key={m.id} value={m.name} className="text-xs">
                        {m.name}
                        {m.onCall ? ' · on-call' : ''}
                      </SelectItem>
                    ))}
                    <SelectItem value="__none" className="text-xs text-muted-foreground">Unassign</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground" onClick={() => setChecked(new Set())}>
                  Clear
                </Button>
              </div>
            )}
          </div>
          {[...open, ...resolvedShown].map((i) => {
            const tone = statusTone(i.status === 'resolved' ? i.status : i.severity)
            let timeline: TimelineEntry[] = []
            try {
              timeline = JSON.parse(i.timeline || '[]')
            } catch {
              timeline = []
            }
            return (
              <div
                key={i.id}
                data-incident-id={i.id}
                className={cn(
                  'card-surface overflow-hidden',
                  checked.has(i.id) && 'ring-1 ring-primary/40',
                  flashId === i.id && 'ring-2 ring-primary/60',
                )}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={selected?.id === i.id}
                  className="flex w-full cursor-pointer items-start gap-3 p-4 text-left transition-colors hover:bg-accent/20"
                  onClick={() => setSelected(selected?.id === i.id ? null : (i as OpenIncident))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelected(selected?.id === i.id ? null : (i as OpenIncident))
                    }
                  }}
                >
                  {i.status !== 'resolved' && (
                    <span className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={checked.has(i.id)}
                        onCheckedChange={() => toggleRow(i.id)}
                        aria-label={`Select incident ${i.title}`}
                        className="mt-1.5"
                      />
                    </span>
                  )}
                  <span className="mt-1 h-8 w-1 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium">{i.title}</span>
                      <StatusPill status={i.status} />
                      <span className="rounded border bg-muted/40 px-1.5 py-px font-mono text-[9px] uppercase text-muted-foreground">
                        {i.source}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">{i.serviceKey}</span>
                      <span>started {timeAgo(i.startedAt)}</span>
                      {i.assignee && <span>assignee {i.assignee}</span>}
                    </div>
                  </div>
                  {i.status !== 'resolved' && (
                    <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {i.status === 'triggered' && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={incidentAction.isPending} onClick={() => act(i.id, 'acknowledge')}>
                          Ack
                        </Button>
                      )}
                      {i.status === 'acknowledged' && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={incidentAction.isPending} onClick={() => act(i.id, 'mitigate')}>
                          Mitigate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px] text-ok hover:text-ok" disabled={incidentAction.isPending} onClick={() => act(i.id, 'resolve')}>
                        Resolve
                      </Button>
                    </div>
                  )}
                </div>

                {selected?.id === i.id && (
                  <div className="border-t bg-muted/10 px-6 py-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Assignee</span>
                      <Select
                        value={i.assignee ?? '__none'}
                        onValueChange={(v) => assignOne(i.id, v === '__none' ? null : v)}
                        disabled={assignIncident.isPending}
                      >
                        <SelectTrigger className="h-7 w-44 text-[11px]">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          {team.map((m) => (
                            <SelectItem key={m.id} value={m.name} className="text-xs">
                              {m.name}
                              {m.onCall ? ' · on-call' : ''}
                            </SelectItem>
                          ))}
                          <SelectItem value="__none" className="text-xs text-muted-foreground">Unassigned</SelectItem>
                        </SelectContent>
                      </Select>
                      <UserPlus className="h-3 w-3 text-muted-foreground" />
                    </div>
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Timeline</div>
                    <ol className="relative space-y-3 border-l pl-4">
                      {timeline.map((t, idx) => (
                        <li key={idx} className="relative">
                          <span
                            className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-background"
                            style={{ background: TONE_COLOR[statusTone(t.event)] }}
                          />
                          <div className="flex items-center gap-2 text-[11px]">
                            <span className="font-medium capitalize">{t.event}</span>
                            <span className="text-muted-foreground">{timeAgo(t.ts)}</span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">{t.detail}</div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )
          })}
          {open.length === 0 && (
            <div className="card-surface">
              <EmptyState title="No open incidents" hint="AIOps anomalies can be promoted from the AIOps view" />
            </div>
          )}
        </TabsContent>

        <TabsContent value="rules" className="mt-3">
          <div className="card-surface overflow-hidden">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b bg-muted/30 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Service</th>
                  <th className="px-3 py-2.5 font-medium">Condition</th>
                  <th className="hidden px-3 py-2.5 font-medium sm:table-cell">Window</th>
                  <th className="px-3 py-2.5 font-medium">Severity</th>
                  <th className="px-3 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 text-right font-medium">Test-fire</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/20">
                    <td className="px-4 py-2.5 font-mono text-[11px]">{r.serviceKey}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px] text-primary">{r.metric}</span>
                      {r.metric.startsWith('slo.') && (
                        <span
                          className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-violet-500/30 bg-violet-500/10 px-1 py-px align-middle text-[8px] font-semibold uppercase tracking-wider text-violet-500"
                          title="Report-backed: evaluated against the newest SLA report"
                        >
                          <Gauge className="h-2.5 w-2.5" /> SLO
                        </span>
                      )}
                      <span className="mx-1 text-muted-foreground">{r.comparator === 'above' ? '>' : '<'}</span>
                      <span className="tabular font-medium">{r.threshold}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 tabular text-muted-foreground sm:table-cell">{r.windowMinutes}m</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={r.severity} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={r.enabled ? 'text-[11px] text-ok' : 'text-[11px] text-muted-foreground'}>
                        {r.enabled ? 'armed' : 'muted'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-[11px]"
                        disabled={testRule.isPending}
                        onClick={() => testSavedRule(r)}
                        aria-label={`Test-fire rule ${r.metric} on ${r.serviceKey}`}
                      >
                        <FlaskConical className={cn('h-3 w-3', testRule.isPending && 'animate-pulse')} />
                        Test
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
              Test evaluates the rule read-only - gateway metrics against live telemetry, <span className="font-medium text-foreground/70">slo.*</span> rules against the newest SLA report. If it would fire, you can register a DRILL incident from the toast to rehearse ack/mitigate/resolve.
            </div>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-3">
          <div className="card-surface">
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[12px] font-medium">Audit trail</span>
              <span className="text-[10px] text-muted-foreground">
                every lifecycle + assignment event across the register
              </span>
              <Select value={activityEvent} onValueChange={(v) => setActivityEvent(v === '__all' ? '' : v)}>
                <SelectTrigger className="ml-auto h-7 w-40 text-[11px]"><SelectValue placeholder="All events" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all" className="text-xs">all events</SelectItem>
                  {['triggered', 'acknowledged', 'mitigated', 'resolved', 'assignment'].map((e) => (
                    <SelectItem key={e} value={e} className="text-xs capitalize">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="scroll-thin max-h-[560px] overflow-y-auto">
              {activity.isLoading && !activity.data ? (
                <div className="space-y-2 p-4">
                  {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : activity.data && activity.data.events.length > 0 ? (
                <ol className="relative px-5 py-4">
                  {activity.data.events.map((e, idx) => {
                    const tone = EVENT_TONE[e.event] ?? 'neutral'
                    return (
                      <li
                        key={`${e.incidentId}-${e.ts}-${idx}`}
                        className="relative flex items-start gap-3 pb-3.5 last:pb-0"
                      >
                        {idx < activity.data!.events.length - 1 && (
                          <span className="absolute left-[7px] top-5 h-full w-px bg-border" aria-hidden />
                        )}
                        <span
                          className="mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-background"
                          style={{ background: TONE_COLOR[tone] }}
                          aria-hidden
                        />
                        <button
                          type="button"
                          onClick={() => jumpToIncident(e.incidentId)}
                          title="Open this incident in the register"
                          className="group min-w-0 flex-1 cursor-pointer rounded-lg border bg-card/40 px-3 py-2 text-left transition-colors hover:border-ring/50 hover:bg-accent/20"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-[11px] font-semibold capitalize" style={{ color: TONE_COLOR[tone] }}>
                              {e.event}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">{e.serviceKey}</span>
                            <span className="text-[10px] text-muted-foreground">{e.incidentTitle}</span>
                            <span className="ml-auto flex shrink-0 items-center gap-1.5">
                              <span className="flex items-center gap-0.5 text-[10px] text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                <Crosshair className="h-2.5 w-2.5" /> open
                              </span>
                              <span className="text-[10px] tabular text-muted-foreground">{timeAgo(e.ts)}</span>
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">{e.detail}</div>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <EmptyState title="No activity yet" hint="acknowledge, mitigate or assign an incident to start the trail" />
              )}
              {activity.data && (
                <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">
                  showing {activity.data.events.length} of {activity.data.total} events · newest first · refreshes every 15s
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ icon, label, value, filteredValue, tone }: { icon: React.ReactNode; label: string; value: number; filteredValue?: number; tone: 'ok' | 'warn' | 'crit' | 'neutral' }) {
  const filtering = typeof filteredValue === 'number'
  return (
    <div
      className={cn('card-surface flex items-center gap-3 p-4 transition-colors', filtering && filteredValue === 0 && 'opacity-55')}
      title={filtering ? `${filteredValue} of ${value} match the active filter` : undefined}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ color: TONE_COLOR[tone] }}>
        {icon}
      </span>
      <div>
        <div className="text-lg font-semibold tabular leading-none">
          {filtering ? filteredValue : value}
          {filtering && (
            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground tabular">/ {value}</span>
          )}
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}{filtering && ' · filtered'}
        </div>
      </div>
    </div>
  )
}

function NewRuleDialog() {
  const create = useCreateRule()
  const testRule = useTestRule()
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<RuleEvaluation | null>(null)
  const [form, setForm] = useState({
    serviceKey: 'api-gateway',
    metric: 'latency.p99',
    comparator: 'above',
    threshold: '250',
    windowMinutes: '5',
    severity: 'warning',
  })

  const clearPreview = () => setPreview(null)

  const isSlo = form.metric.startsWith('slo.')

  /** Sensible defaults when switching between gateway and SLO metrics. */
  const setMetric = (metric: string) => {
    setForm((f) => ({
      ...f,
      metric,
      comparator: metric === 'slo.availability' ? 'below' : metric === 'slo.burn_rate' ? 'above' : f.comparator,
      threshold: metric === 'slo.burn_rate' ? '2' : metric === 'slo.availability' ? '99.9' : f.threshold,
    }))
    clearPreview()
  }

  const runPreview = () => {
    testRule.mutate(
      {
        serviceKey: form.serviceKey,
        metric: form.metric,
        comparator: form.comparator,
        threshold: Number(form.threshold),
        windowMinutes: Number(form.windowMinutes) || 5,
        severity: form.severity,
      },
      {
        onSuccess: (result) => setPreview(result.evaluation),
        onError: (e: Error) => toast.error('Evaluation failed', { description: e.message }),
      },
    )
  }

  const submit = () => {
    create.mutate(
      {
        serviceKey: form.serviceKey,
        metric: form.metric,
        comparator: form.comparator,
        threshold: Number(form.threshold),
        windowMinutes: Number(form.windowMinutes),
        severity: form.severity,
      },
      {
        onSuccess: () => {
          toast.success('Rule armed', { description: `${form.metric} ${form.comparator} ${form.threshold} on ${form.serviceKey}` })
          setOpen(false)
          setPreview(null)
        },
        onError: (e: Error) => toast.error('Rejected', { description: e.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPreview(null) }}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" /> New rule
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Arm an alert rule</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Labeled label="Service">
            <Select value={form.serviceKey} onValueChange={(v) => { clearPreview(); setForm({ ...form, serviceKey: v }) }}>
              <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['api-gateway', 'checkout-service', 'auth-service', 'search-cluster', 'billing-worker', 'edge-cdn'].map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Labeled>
          <div className="grid grid-cols-3 gap-2">
            <Labeled label="Metric">
              <Select value={form.metric} onValueChange={setMetric}>
                <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel className="text-[9px] uppercase tracking-wider text-muted-foreground">Gateway telemetry</SelectLabel>
                    {['error.rate', 'latency.p99', 'latency.p95', 'request.rate', 'cpu.usage'].map((m) => (
                      <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="text-[9px] uppercase tracking-wider text-muted-foreground">SLO · reporting plane</SelectLabel>
                    <SelectItem value="slo.burn_rate" className="font-mono text-xs">slo.burn_rate</SelectItem>
                    <SelectItem value="slo.availability" className="font-mono text-xs">slo.availability</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Comparator">
              <Select value={form.comparator} onValueChange={(v) => { clearPreview(); setForm({ ...form, comparator: v }) }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">above</SelectItem>
                  <SelectItem value="below">below</SelectItem>
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Threshold">
              <Input className="h-8 text-xs tabular" value={form.threshold} onChange={(e) => { clearPreview(); setForm({ ...form, threshold: e.target.value }) }} inputMode="decimal" />
            </Labeled>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label={isSlo ? 'Window (report-defined)' : 'Window (minutes)'}>
              <Input
                className="h-8 text-xs tabular disabled:opacity-60"
                value={form.windowMinutes}
                onChange={(e) => { clearPreview(); setForm({ ...form, windowMinutes: e.target.value }) }}
                inputMode="numeric"
                disabled={isSlo}
                placeholder={isSlo ? 'latest report' : undefined}
              />
            </Labeled>
            <Labeled label="Severity">
              <Select value={form.severity} onValueChange={(v) => { clearPreview(); setForm({ ...form, severity: v }) }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['info', 'warning', 'critical'].map((s) => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
          </div>

          {isSlo && (
            <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
              <Gauge className="mt-0.5 h-3 w-3 shrink-0 text-violet-500" />
              <span>
                Report-backed rule: evaluated against the <b className="text-foreground/80">newest SLA report</b> from the reporting plane for the chosen service - no gateway window applies. burn_rate ≥ 1 means the error budget is being consumed at or above target pace.
              </span>
            </div>
          )}

          {/* Live dry-run against gateway telemetry before arming */}
          <div className="rounded-lg border bg-muted/20 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dry-run preview</span>
              <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" disabled={testRule.isPending || !form.threshold} onClick={runPreview}>
                <FlaskConical className={cn('h-3 w-3', testRule.isPending && 'animate-pulse')} />
                {testRule.isPending ? 'Evaluating…' : 'Evaluate now'}
              </Button>
            </div>
            {preview && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center gap-2 text-[11px]">
                  {preview.evaluable ? (
                    <span
                      className="rounded px-1.5 py-px font-semibold"
                      style={{
                        background: preview.wouldFire ? TONE_COLOR.crit : TONE_COLOR.ok,
                        color: 'white',
                      }}
                    >
                      {preview.wouldFire ? 'WOULD FIRE' : 'quiet'}
                    </span>
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-px font-semibold text-muted-foreground">no data</span>
                  )}
                  {preview.evaluable && (
                    <span className="tabular">
                      current <b>{preview.currentValue}</b> vs {preview.comparator} {preview.threshold}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">{preview.reason}</div>
              </div>
            )}
            {!preview && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {isSlo
                  ? 'Evaluates the condition against the newest SLA report without arming anything.'
                  : 'Evaluates the condition against live gateway telemetry without arming anything.'}
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" className="h-8 text-xs" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Arming…' : 'Arm rule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}
