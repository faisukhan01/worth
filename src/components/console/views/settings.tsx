'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, SectionHeader, TONE_COLOR, LiveDot } from '@/components/console/primitives'
import { timeAgo } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { Copy, KeyRound, Plus, Server, Users, Ban } from 'lucide-react'

interface KeyRow {
  id: string
  name: string
  prefix: string
  env: string
  revoked: boolean
  createdAt: string
  lastUsedAt: string | null
  masked: string
}

interface SettingsPayload {
  team: { id: string; name: string; email: string; role: string; hue: number; onCall: boolean }[]
  services: { key: string; name: string; owner: string; tier: string }[]
  platform: Record<string, string>
}

export function SettingsView() {
  const { data, isLoading } = useQuery({
    queryKey: ['settings-view'],
    queryFn: async (): Promise<{ keys: KeyRow[] } & SettingsPayload> => {
      const [keys, settings] = await Promise.all([
        fetch('/api/keys', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/settings', { cache: 'no-store' }).then((r) => r.json()),
      ])
      return { ...settings, keys: keys.keys }
    },
    refetchInterval: 20_000,
  })
  const [newKey, setNewKey] = useState({ name: '', env: 'production' })

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    )
  }
  if (!data) return <EmptyState title="Settings unavailable" />

  const provision = async () => {
    const res = await fetch('/api/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(newKey),
    })
    if (res.ok) {
      toast.success('API key provisioned', { description: `${newKey.name} · copy the prefix now; it is masked afterwards.` })
      setNewKey({ name: '', env: 'production' })
      window.dispatchEvent(new Event('refresh-keys'))
    } else {
      const body = await res.json().catch(() => ({ error: 'failed' }))
      toast.error('Provisioning rejected', { description: body.error })
    }
  }

  const revoke = async (id: string) => {
    const res = await fetch(`/api/keys?id=${id}`, { method: 'DELETE' })
    if (res.ok) toast.success('Key revoked')
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground">
          {data.platform.name} · {data.platform.org} · {data.platform.region}
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* API keys */}
        <div className="card-surface">
          <SectionHeader title="API keys" hint="ingest auth · x-api-key" right={<KeyRound className="h-3.5 w-3.5 text-muted-foreground" />} />
          <div className="space-y-2 px-4 pb-4">
            {data.keys.map((k) => (
              <div key={k.id} className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5">
                <span className={`h-1.5 w-1.5 rounded-full ${k.revoked ? 'bg-crit' : 'live-dot bg-ok'}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12px] font-medium">
                    {k.name}
                    <span className="rounded border bg-muted/40 px-1 font-mono text-[9px] uppercase text-muted-foreground">{k.env}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {k.revoked ? k.prefix : k.masked} · created {timeAgo(k.createdAt)}
                    {k.lastUsedAt ? ` · used ${timeAgo(k.lastUsedAt)}` : ''}
                  </div>
                </div>
                {!k.revoked && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="copy prefix"
                      onClick={() => {
                        void navigator.clipboard.writeText(k.prefix)
                        toast('Prefix copied', { description: 'Full secret is never displayed after creation.' })
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-crit hover:text-crit" aria-label="revoke key" onClick={() => void revoke(k.id)}>
                      <Ban className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            <div className="flex gap-2 rounded-lg border border-dashed p-2.5">
              <Input
                value={newKey.name}
                onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                placeholder="Key name (e.g. edge fleet)"
                className="h-8 flex-1 text-xs"
                aria-label="new key name"
              />
              <Select value={newKey.env} onValueChange={(v) => setNewKey({ ...newKey, env: v })}>
                <SelectTrigger className="h-8 w-32 text-xs" aria-label="environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['production', 'staging', 'development'].map((e) => (
                    <SelectItem key={e} value={e} className="text-xs capitalize">{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 gap-1 text-xs" onClick={() => void provision()} disabled={newKey.name.trim().length < 3}>
                <Plus className="h-3.5 w-3.5" /> Provision
              </Button>
            </div>
          </div>
        </div>

        {/* Team */}
        <div className="card-surface">
          <SectionHeader title="Team & on-call" hint="rotation is informational in this tier" right={<Users className="h-3.5 w-3.5 text-muted-foreground" />} />
          <div className="space-y-1.5 px-4 pb-4">
            {data.team.map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-lg border bg-card/40 p-2.5">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: `hsl(${m.hue} 55% 42%)` }}
                >
                  {m.name.split(' ').map((p) => p[0]).join('')}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium">
                    {m.name}
                    {m.onCall && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-ok">
                        <LiveDot tone="ok" /> on-call
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{m.email}</div>
                </div>
                <span className="rounded border bg-muted/40 px-1.5 py-0.5 text-[10px] capitalize text-muted-foreground">{m.role}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform identity */}
      <div className="card-surface">
        <SectionHeader title="Platform topology" hint="polyglot data plane inventory" right={<Server className="h-3.5 w-3.5 text-muted-foreground" />} />
        <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-5">
          {Object.entries(data.platform)
            .filter(([k]) => !['name', 'org', 'region'].includes(k))
            .map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-card/40 p-3">
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {k.replace(/([A-Z])/g, ' $1').trim()}
                </div>
                <div className="mt-1 font-mono text-[11px]">{v}</div>
              </div>
            ))}
        </div>
        <div className="px-4 pb-4 text-[10px] text-muted-foreground">
          Segments in <span style={{ color: TONE_COLOR.ok }}>green</span> are verified by the footer probe every 20 seconds.
        </div>
      </div>
    </div>
  )
}
