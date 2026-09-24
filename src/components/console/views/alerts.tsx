'use client'

import { useState } from 'react'
import { useAlerts, useIncidentAction, useCreateRule, type OpenIncident } from '@/hooks/use-console-data'
import { StatusPill, EmptyState, TONE_COLOR, statusTone, SectionHeader } from '@/components/console/primitives'
import { timeAgo } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { BellRing, Plus, ShieldCheck, Siren, Timer } from 'lucide-react'

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

export function AlertsView() {
  const { data, isLoading } = useAlerts()
  const incidentAction = useIncidentAction()
  const [selected, setSelected] = useState<OpenIncident | null>(null)

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

  const open = data.incidents.filter((i) => i.status !== 'resolved')
  const resolved = data.incidents.filter((i) => i.status === 'resolved')

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Alerts & incidents</h1>
          <p className="text-xs text-muted-foreground">
            {data.counts.open} open · {data.counts.rulesEnabled}/{data.counts.rules} rules armed
          </p>
        </div>
        <NewRuleDialog />
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Siren className="h-3.5 w-3.5" />} label="Triggered" value={data.counts.triggered} tone="crit" />
        <StatCard icon={<BellRing className="h-3.5 w-3.5" />} label="Acknowledged" value={data.counts.acknowledged} tone="warn" />
        <StatCard icon={<Timer className="h-3.5 w-3.5" />} label="Mitigated" value={data.counts.mitigated} tone="neutral" />
        <StatCard icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Resolved (register)" value={data.counts.resolved} tone="ok" />
      </div>

      <Tabs defaultValue="incidents">
        <TabsList className="h-8">
          <TabsTrigger value="incidents" className="text-xs">Incidents</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="incidents" className="mt-3 space-y-2">
          {[...open, ...resolved.slice(0, 6)].map((i) => {
            const tone = statusTone(i.status === 'resolved' ? i.status : i.severity)
            let timeline: TimelineEntry[] = []
            try {
              timeline = JSON.parse(i.timeline || '[]')
            } catch {
              timeline = []
            }
            return (
              <div key={i.id} className="card-surface overflow-hidden">
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
                  <th className="px-4 py-2.5 text-right font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-accent/20">
                    <td className="px-4 py-2.5 font-mono text-[11px]">{r.serviceKey}</td>
                    <td className="px-3 py-2.5">
                      <span className="font-mono text-[11px] text-primary">{r.metric}</span>
                      <span className="mx-1 text-muted-foreground">{r.comparator === 'above' ? '>' : '<'}</span>
                      <span className="tabular font-medium">{r.threshold}</span>
                    </td>
                    <td className="hidden px-3 py-2.5 tabular text-muted-foreground sm:table-cell">{r.windowMinutes}m</td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={r.severity} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={r.enabled ? 'text-[11px] text-ok' : 'text-[11px] text-muted-foreground'}>
                        {r.enabled ? 'armed' : 'muted'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: 'ok' | 'warn' | 'crit' | 'neutral' }) {
  return (
    <div className="card-surface flex items-center gap-3 p-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border" style={{ color: TONE_COLOR[tone] }}>
        {icon}
      </span>
      <div>
        <div className="text-lg font-semibold tabular leading-none">{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      </div>
    </div>
  )
}

function NewRuleDialog() {
  const create = useCreateRule()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    serviceKey: 'api-gateway',
    metric: 'latency.p99',
    comparator: 'above',
    threshold: '250',
    windowMinutes: '5',
    severity: 'warning',
  })

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
        },
        onError: (e: Error) => toast.error('Rejected', { description: e.message }),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            <Select value={form.serviceKey} onValueChange={(v) => setForm({ ...form, serviceKey: v })}>
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
              <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v })}>
                <SelectTrigger className="h-8 font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['error.rate', 'latency.p99', 'latency.p95', 'request.rate', 'cpu.usage'].map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Comparator">
              <Select value={form.comparator} onValueChange={(v) => setForm({ ...form, comparator: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">above</SelectItem>
                  <SelectItem value="below">below</SelectItem>
                </SelectContent>
              </Select>
            </Labeled>
            <Labeled label="Threshold">
              <Input className="h-8 text-xs tabular" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} inputMode="decimal" />
            </Labeled>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Labeled label="Window (minutes)">
              <Input className="h-8 text-xs tabular" value={form.windowMinutes} onChange={(e) => setForm({ ...form, windowMinutes: e.target.value })} inputMode="numeric" />
            </Labeled>
            <Labeled label="Severity">
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['info', 'warning', 'critical'].map((s) => (
                    <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labeled>
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
