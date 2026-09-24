'use client'

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Ban, Building2, CheckCircle2, Copy, ExternalLink, Globe, KeyRound,
  Plus, RefreshCw, ShieldCheck, Trash2, Webhook, XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, KpiTile, SectionHeader, StatusPill, TONE_COLOR } from '@/components/console/primitives'
import { timeAgo } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ---- types ------------------------------------------------------------------

interface TenantKeyRow {
  id: string
  label: string
  prefix: string
  masked: string
  revoked: boolean
  createdAt: string
  lastUsedAt: string | null
}

interface SiteRow {
  id: string
  label: string
  url: string
  kind: string
  lastStatus: string | null
  lastHttpStatus: number | null
  lastLatencyMs: number | null
  lastCheckedAt: string | null
  createdAt: string
}

interface CredentialRow {
  id: string
  kind: string
  name: string
  masked: string
  createdAt: string
}

interface TenantRow {
  id: string
  name: string
  slug: string
  contact: string
  plan: string
  status: string
  notes: string
  createdAt: string
  keys: TenantKeyRow[]
  sites: SiteRow[]
  credentials: CredentialRow[]
}

const PLANS = ['starter', 'growth', 'scale', 'enterprise'] as const
const SITE_KINDS = ['website', 'api', 'software'] as const
const CRED_KINDS = ['webhook', 'slack', 'custom'] as const

const PLAN_TONE: Record<string, string> = {
  starter: 'text-muted-foreground',
  growth: 'text-ok',
  scale: 'text-warn',
  enterprise: 'text-primary',
}

// ---- fetch helpers ------------------------------------------------------------

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(String(json.error ?? `request failed (${res.status})`))
  return json as T
}

// ---- view ---------------------------------------------------------------------

export function AdminView() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () => send<{ tenants: TenantRow[] }>('/api/admin/tenants', 'GET'),
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
  })

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<TenantRow | null>(null)
  const [revealed, setRevealed] = useState<{ keyId: string; secret: string } | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const tenants = data?.tenants ?? []
  const selected = useMemo(
    () => tenants.find((t) => t.id === selectedId) ?? tenants[0] ?? null,
    [tenants, selectedId],
  )

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-tenants'] })

  const kpis = useMemo(() => {
    const allSites = tenants.flatMap((t) => t.sites)
    return {
      companies: tenants.length,
      activeKeys: tenants.flatMap((t) => t.keys).filter((k) => !k.revoked).length,
      sites: allSites.length,
      sitesDown: allSites.filter((s) => s.lastStatus === 'down').length,
    }
  }, [tenants])

  // ---- actions ----------------------------------------------------------------

  const patchTenant = async (id: string, patch: Record<string, unknown>, okMsg: string) => {
    try {
      await send(`/api/admin/tenants/${id}`, 'PATCH', patch)
      toast.success(okMsg)
      refresh()
    } catch (e) {
      toast.error('Update failed', { description: (e as Error).message })
    }
  }

  const deleteTenant = async (t: TenantRow) => {
    setBusy(true)
    try {
      await send(`/api/admin/tenants/${t.id}`, 'DELETE')
      toast.success(`${t.name} removed`, { description: 'Keys, sites and credentials were revoked.' })
      if (selectedId === t.id) setSelectedId(null)
      setDeleteTarget(null)
      refresh()
    } catch (e) {
      toast.error('Delete failed', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const generateKey = async (tenant: TenantRow, label: string) => {
    try {
      const res = await send<{ secret: string; key: TenantKeyRow }>(
        `/api/admin/tenants/${tenant.id}/keys`, 'POST', { label },
      )
      setRevealed({ keyId: res.key.id, secret: res.secret })
      toast.success(`Key "${label}" provisioned`, { description: 'Copy the secret now - it is shown once.' })
      refresh()
    } catch (e) {
      toast.error('Key generation failed', { description: (e as Error).message })
    }
  }

  const revokeKey = async (k: TenantKeyRow) => {
    try {
      await send(`/api/admin/keys/${k.id}`, 'DELETE')
      toast.success(`Key ${k.masked} revoked`)
      refresh()
    } catch (e) {
      toast.error('Revoke failed', { description: (e as Error).message })
    }
  }

  const checkSite = async (site: SiteRow) => {
    setCheckingId(site.id)
    try {
      const res = await send<{ probe: { ok: boolean; httpStatus: number | null; latencyMs: number } }>(
        `/api/admin/sites/${site.id}`, 'POST',
      )
      if (res.probe.ok) {
        toast.success(`${site.label} is up`, { description: `HTTP ${res.probe.httpStatus} · ${res.probe.latencyMs}ms` })
      } else {
        toast.error(`${site.label} is DOWN`, {
          description: res.probe.httpStatus ? `HTTP ${res.probe.httpStatus} · ${res.probe.latencyMs}ms` : 'unreachable / timeout',
        })
      }
      refresh()
    } catch (e) {
      toast.error('Probe failed', { description: (e as Error).message })
    } finally {
      setCheckingId(null)
    }
  }

  const copySecret = (secret: string) => {
    void navigator.clipboard.writeText(secret)
    toast('Copied to clipboard', { description: 'Anyone with this key can ingest telemetry for the company.' })
  }

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Admin · Companies
          </h1>
          <p className="text-xs text-muted-foreground">
            Onboard client companies, provision their ingest keys and monitor their endpoints
          </p>
        </div>
        <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add company
        </Button>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Companies" value={String(kpis.companies)} sub="registered tenants" />
        <KpiTile label="Active keys" value={String(kpis.activeKeys)} sub="pg_live_ ingest secrets" tone="ok" />
        <KpiTile label="Endpoints" value={String(kpis.sites)} sub="websites & software monitored" />
        <KpiTile
          label="Endpoints down"
          value={String(kpis.sitesDown)}
          sub={kpis.sitesDown ? 'need attention' : 'all reachable'}
          tone={kpis.sitesDown ? 'crit' : 'ok'}
        />
      </div>

      {/* master-detail */}
      <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        {/* company list */}
        <div className="card-surface self-start">
          <SectionHeader
            title="Registered companies"
            hint={`${tenants.length} total`}
            right={<Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
          />
          <div className="max-h-[560px] space-y-1.5 overflow-y-auto px-3 pb-3 scroll-thin">
            {tenants.length === 0 && (
              <EmptyState title="No companies yet" hint="Use “Add company” to onboard the first client" />
            )}
            {tenants.map((t) => {
              const down = t.sites.filter((s) => s.lastStatus === 'down').length
              const active = selected?.id === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'group w-full rounded-lg border p-2.5 text-left transition-colors',
                    active
                      ? 'border-ring/50 bg-accent'
                      : 'border-transparent bg-card/40 hover:border-border hover:bg-accent/50',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: TONE_COLOR[t.status === 'active' ? 'ok' : 'crit'] }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{t.name}</span>
                    <span className={cn('text-[10px] font-medium uppercase', PLAN_TONE[t.plan])}>{t.plan}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2.5 pl-3.5 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><KeyRound className="h-2.5 w-2.5" />{t.keys.filter((k) => !k.revoked).length}</span>
                    <span className="flex items-center gap-1"><Globe className="h-2.5 w-2.5" />{t.sites.length}</span>
                    {down > 0 && (
                      <span className="flex items-center gap-1 font-medium" style={{ color: TONE_COLOR.crit }}>
                        <XCircle className="h-2.5 w-2.5" />{down} down
                      </span>
                    )}
                    <span className="ml-auto">{timeAgo(t.createdAt)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* detail */}
        {selected ? (
          <TenantDetail
            tenant={selected}
            revealed={revealed}
            clearRevealed={() => setRevealed(null)}
            checkingId={checkingId}
            busy={busy}
            onPatch={patchTenant}
            onDelete={() => setDeleteTarget(selected)}
            onGenerateKey={generateKey}
            onRevokeKey={revokeKey}
            onCheckSite={checkSite}
            onCopy={copySecret}
            onChanged={refresh}
          />
        ) : (
          <div className="card-surface flex items-center justify-center">
            <EmptyState title="Select a company" hint="or add a new one to get started" />
          </div>
        )}
      </div>

      {/* add company dialog */}
      <AddCompanyDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(tenant, firstKey) => {
          setSelectedId(tenant.id)
          setRevealed({ keyId: firstKey.id, secret: firstKey.secret })
          toast.success(`${tenant.name} onboarded`, {
            description: 'Default ingest key provisioned - copy the secret from the detail panel.',
          })
          refresh()
        }}
      />

      {/* delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the company along with{' '}
              {deleteTarget?.keys.length ?? 0} API key(s), {deleteTarget?.sites.length ?? 0} monitored
              endpoint(s) and {deleteTarget?.credentials.length ?? 0} credential(s). Software still
              sending with these keys will start receiving 401s.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-crit text-white hover:bg-crit/90"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) void deleteTenant(deleteTarget)
              }}
            >
              Delete company
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---- tenant detail -------------------------------------------------------------

function TenantDetail({
  tenant,
  revealed,
  clearRevealed,
  checkingId,
  busy,
  onPatch,
  onDelete,
  onGenerateKey,
  onRevokeKey,
  onCheckSite,
  onCopy,
  onChanged,
}: {
  tenant: TenantRow
  revealed: { keyId: string; secret: string } | null
  clearRevealed: () => void
  checkingId: string | null
  busy: boolean
  onPatch: (id: string, patch: Record<string, unknown>, okMsg: string) => Promise<void>
  onDelete: () => void
  onGenerateKey: (tenant: TenantRow, label: string) => Promise<void>
  onRevokeKey: (k: TenantKeyRow) => Promise<void>
  onCheckSite: (s: SiteRow) => Promise<void>
  onCopy: (secret: string) => void
  onChanged: () => void
}) {
  const [keyLabel, setKeyLabel] = useState('')
  const [siteForm, setSiteForm] = useState({ label: '', url: '', kind: 'website' })
  const [credForm, setCredForm] = useState({ name: '', value: '', kind: 'webhook' })

  const addSite = async () => {
    try {
      await send(`/api/admin/tenants/${tenant.id}/sites`, 'POST', siteForm)
      toast.success(`Now monitoring ${siteForm.url}`)
      setSiteForm({ label: '', url: '', kind: 'website' })
      onChanged()
    } catch (e) {
      toast.error('Could not add endpoint', { description: (e as Error).message })
    }
  }

  const removeSite = async (s: SiteRow) => {
    try {
      await send(`/api/admin/sites/${s.id}`, 'DELETE')
      toast.success(`Stopped monitoring ${s.label}`)
      onChanged()
    } catch (e) {
      toast.error('Remove failed', { description: (e as Error).message })
    }
  }

  const addCredential = async () => {
    try {
      await send(`/api/admin/tenants/${tenant.id}/credentials`, 'POST', credForm)
      toast.success(`Credential "${credForm.name}" stored`, { description: 'Masked on read - only admins can reveal usage.' })
      setCredForm({ name: '', value: '', kind: 'webhook' })
      onChanged()
    } catch (e) {
      toast.error('Could not store credential', { description: (e as Error).message })
    }
  }

  const removeCredential = async (c: CredentialRow) => {
    try {
      await send(`/api/admin/credentials/${c.id}`, 'DELETE')
      toast.success('Credential removed')
      onChanged()
    } catch (e) {
      toast.error('Remove failed', { description: (e as Error).message })
    }
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* profile header */}
      <div className="card-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-[15px] font-semibold tracking-tight">{tenant.name}</h2>
              <Badge variant="outline" className={cn('text-[10px] uppercase', PLAN_TONE[tenant.plan])}>
                {tenant.plan}
              </Badge>
              <StatusPill status={tenant.status === 'active' ? 'ok' : 'critical'} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{tenant.slug}</span>
              {tenant.contact && <span>· {tenant.contact}</span>}
              <span>· onboarded {timeAgo(tenant.createdAt)}</span>
            </div>
            {tenant.notes && <p className="mt-1.5 max-w-prose text-[11px] text-muted-foreground">{tenant.notes}</p>}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {tenant.status === 'active' ? 'active' : 'suspended'}
              <Switch
                checked={tenant.status === 'active'}
                aria-label={`toggle ${tenant.name} status`}
                onCheckedChange={(v) =>
                  void onPatch(tenant.id, { status: v ? 'active' : 'suspended' }, v ? 'Company activated' : 'Company suspended - keys stop being honored')
                }
              />
            </label>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-crit hover:text-crit"
              aria-label={`delete ${tenant.name}`}
              onClick={onDelete}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* keys */}
      <div className="card-surface">
        <SectionHeader
          title="Ingest API keys"
          hint="x-api-key auth · activate by adding the secret to the gateway API_KEYS allow-list"
          right={<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />}
        />
        <div className="space-y-1.5 px-4 pb-4">
          {revealed && (
            <div className="rise-in rounded-lg border border-primary/40 bg-primary/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                  New key secret - shown once
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="copy secret" onClick={() => onCopy(revealed.secret)}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={clearRevealed}>
                    Done
                  </Button>
                </div>
              </div>
              <code className="mt-1 block select-all break-all rounded bg-card/80 px-2 py-1.5 font-mono text-[11px]">
                {revealed.secret}
              </code>
            </div>
          )}
          {tenant.keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5">
              <span className={cn('h-1.5 w-1.5 rounded-full', k.revoked ? 'bg-crit' : 'bg-ok live-dot')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium">{k.label}</div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {k.masked} · created {timeAgo(k.createdAt)}
                  {k.lastUsedAt ? ` · used ${timeAgo(k.lastUsedAt)}` : ' · never used'}
                </div>
              </div>
              {k.revoked ? (
                <Badge variant="outline" className="text-[9px] uppercase text-crit">revoked</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-crit hover:text-crit"
                  aria-label={`revoke key ${k.label}`}
                  onClick={() => void onRevokeKey(k)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <div className="flex gap-2 rounded-lg border border-dashed p-2.5">
            <Input
              value={keyLabel}
              onChange={(e) => setKeyLabel(e.target.value)}
              placeholder="Key label (e.g. website ingest)"
              className="h-8 flex-1 text-xs"
              aria-label="new key label"
            />
            <Button
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={() => void onGenerateKey(tenant, keyLabel.trim() || 'ingest')}
            >
              <Plus className="h-3.5 w-3.5" /> Generate
            </Button>
          </div>
        </div>
      </div>

      {/* sites */}
      <div className="card-surface">
        <SectionHeader
          title="Websites & software endpoints"
          hint="reachability probe · GET with 8s timeout"
          right={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
        />
        <div className="max-h-72 space-y-1.5 overflow-y-auto px-4 pb-2 scroll-thin">
          {tenant.sites.length === 0 && (
            <EmptyState title="No endpoints yet" hint="Add the company's website or API below" />
          )}
          {tenant.sites.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5">
              {s.lastStatus === 'up' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: TONE_COLOR.ok }} />
              ) : s.lastStatus === 'down' ? (
                <XCircle className="h-4 w-4 shrink-0" style={{ color: TONE_COLOR.crit }} />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-muted-foreground/50" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <span className="truncate">{s.label}</span>
                  <Badge variant="outline" className="text-[9px] uppercase text-muted-foreground">{s.kind}</Badge>
                </div>
                <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{s.url}</span>
                  <a href={s.url} target="_blank" rel="noreferrer" aria-label={`open ${s.label}`} className="shrink-0 hover:text-foreground">
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {s.lastCheckedAt
                    ? `${s.lastStatus ?? '?'}${s.lastHttpStatus ? ` · HTTP ${s.lastHttpStatus}` : ' · unreachable'} · ${s.lastLatencyMs ?? '?'}ms · checked ${timeAgo(s.lastCheckedAt)}`
                    : 'never probed'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label={`check ${s.label} now`}
                disabled={checkingId === s.id}
                onClick={() => void onCheckSite(s)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', checkingId === s.id && 'animate-spin')} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-crit hover:text-crit"
                aria-label={`stop monitoring ${s.label}`}
                onClick={() => void removeSite(s)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t px-4 py-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <Input
            value={siteForm.label}
            onChange={(e) => setSiteForm({ ...siteForm, label: e.target.value })}
            placeholder="Label (e.g. Storefront)"
            className="h-8 text-xs"
            aria-label="site label"
          />
          <Input
            value={siteForm.url}
            onChange={(e) => setSiteForm({ ...siteForm, url: e.target.value })}
            placeholder="https://company.com"
            className="h-8 text-xs"
            aria-label="site url"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && siteForm.url.trim()) void addSite()
            }}
          />
          <Select value={siteForm.kind} onValueChange={(v) => setSiteForm({ ...siteForm, kind: v })}>
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="site kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SITE_KINDS.map((k) => <SelectItem key={k} value={k} className="text-xs capitalize">{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 gap-1 text-xs" disabled={!siteForm.url.trim()} onClick={() => void addSite()}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* credentials */}
      <div className="card-surface">
        <SectionHeader
          title="Integration credentials"
          hint="alert webhooks · Slack · vendor keys - stored masked, never displayed in full"
          right={<Webhook className="h-3.5 w-3.5 text-muted-foreground" />}
        />
        <div className="max-h-56 space-y-1.5 overflow-y-auto px-4 pb-2 scroll-thin">
          {tenant.credentials.length === 0 && (
            <EmptyState title="No credentials stored" hint="e.g. the company's Slack webhook for alert delivery" />
          )}
          {tenant.credentials.map((c) => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                <Webhook className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[12px] font-medium">
                  <span className="truncate">{c.name}</span>
                  <Badge variant="outline" className="text-[9px] uppercase text-muted-foreground">{c.kind}</Badge>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">{c.masked} · added {timeAgo(c.createdAt)}</div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-crit hover:text-crit"
                aria-label={`remove credential ${c.name}`}
                onClick={() => void removeCredential(c)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 border-t px-4 py-3 sm:grid-cols-[auto_1fr_1fr_auto]">
          <Select value={credForm.kind} onValueChange={(v) => setCredForm({ ...credForm, kind: v })}>
            <SelectTrigger className="h-8 w-28 text-xs" aria-label="credential kind"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CRED_KINDS.map((k) => <SelectItem key={k} value={k} className="text-xs capitalize">{k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={credForm.name}
            onChange={(e) => setCredForm({ ...credForm, name: e.target.value })}
            placeholder="Name (e.g. Slack #alerts webhook)"
            className="h-8 text-xs"
            aria-label="credential name"
          />
          <Input
            value={credForm.value}
            onChange={(e) => setCredForm({ ...credForm, value: e.target.value })}
            placeholder="Secret value / webhook URL"
            className="h-8 text-xs"
            type="password"
            aria-label="credential value"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && credForm.name.trim() && credForm.value.trim().length >= 8) void addCredential()
            }}
          />
          <Button
            size="sm"
            className="h-8 gap-1 text-xs"
            disabled={credForm.name.trim().length < 2 || credForm.value.trim().length < 8}
            onClick={() => void addCredential()}
          >
            <Plus className="h-3.5 w-3.5" /> Store
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---- add company dialog ----------------------------------------------------------

function AddCompanyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (tenant: TenantRow, firstKey: { id: string; secret: string }) => void
}) {
  const [form, setForm] = useState({
    name: '', contact: '', plan: 'starter', siteLabel: '', siteUrl: '', notes: '',
  })
  const [busy, setBusy] = useState(false)

  const valid = form.name.trim().length >= 2 && (!form.contact.trim() || form.contact.includes('@'))

  const create = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const res = await send<{ tenant: TenantRow; firstKey: { id: string; secret: string } }>(
        '/api/admin/tenants',
        'POST',
        {
          name: form.name.trim(),
          contact: form.contact.trim(),
          plan: form.plan,
          notes: form.notes.trim(),
          website: form.siteUrl.trim() ? { url: form.siteUrl.trim(), label: form.siteLabel.trim() } : undefined,
        },
      )
      onCreated(res.tenant, res.firstKey)
      onOpenChange(false)
      setForm({ name: '', contact: '', plan: 'starter', siteLabel: '', siteUrl: '', notes: '' })
    } catch (e) {
      toast.error('Onboarding failed', { description: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <Building2 className="h-4 w-4 text-primary" /> Onboard a company
          </DialogTitle>
          <DialogDescription className="text-xs">
            Registers the client, provisions a first ingest API key (shown once) and optionally
            starts monitoring their website.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_130px]">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ac-name">Company name *</label>
              <Input
                id="ac-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Corp"
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ac-plan">Plan</label>
              <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                <SelectTrigger id="ac-plan" className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => <SelectItem key={p} value={p} className="text-xs capitalize">{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ac-contact">Contact email</label>
            <Input
              id="ac-contact"
              value={form.contact}
              onChange={(e) => setForm({ ...form, contact: e.target.value })}
              placeholder="ops@acme.com"
              className="h-8 text-xs"
              type="email"
            />
          </div>

          <div className="rounded-lg border border-dashed p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Globe className="h-3 w-3" /> First endpoint to monitor (optional)
            </div>
            <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
              <Input
                value={form.siteLabel}
                onChange={(e) => setForm({ ...form, siteLabel: e.target.value })}
                placeholder="Label"
                className="h-8 text-xs"
                aria-label="site label"
              />
              <Input
                value={form.siteUrl}
                onChange={(e) => setForm({ ...form, siteUrl: e.target.value })}
                placeholder="https://acme.com"
                className="h-8 text-xs"
                aria-label="site url"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground" htmlFor="ac-notes">Notes</label>
            <Textarea
              id="ac-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Contract, escalation contacts, special SLOs…"
              className="min-h-[56px] text-xs"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="h-8 text-xs" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? 'Onboarding…' : 'Onboard company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
