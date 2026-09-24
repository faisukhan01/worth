'use client'

import { useBilling } from '@/hooks/use-console-data'
import { Gauge, MiniBars, ShareBar } from '@/components/console/charts'
import { EmptyState, SectionHeader, TONE_COLOR } from '@/components/console/primitives'
import { fmtNum, usd, fmtDay } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Check, CreditCard, Database, Sparkles } from 'lucide-react'

export function BillingView() {
  const { data, isLoading } = useBilling()

  if (isLoading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-44" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (!data) return <EmptyState title="Usage data unavailable" />

  const { plan, usage, invoice, dailyCost, services } = data
  const quotaTone = usage.quotaPct > 100 ? 'crit' : usage.quotaPct > 80 ? 'warn' : 'ok'

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Usage & metering</h1>
        <p className="text-xs text-muted-foreground">
          billing period {fmtDay(usage.periodStart)} – {fmtDay(usage.periodEnd)} · ledger mirrored from billing-core (Java) semantics
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Plan card */}
        <div className="card-surface p-5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
              <CreditCard className="h-4 w-4" /> Current plan
            </span>
            <Badge className="bg-primary/15 text-primary hover:bg-primary/20" variant="secondary">{plan.key}</Badge>
          </div>
          <div className="mt-3 text-3xl font-semibold tracking-tight">
            {usd(plan.monthlyBase)}
            <span className="text-sm font-normal text-muted-foreground">/mo base</span>
          </div>
          <ul className="mt-4 space-y-2 text-[12px]">
            <PlanRow label="Included events" value={`${fmtNum(plan.includedEvents)}/mo`} />
            <PlanRow label="Included hosts" value={String(plan.includedHosts)} />
            <PlanRow label="Overage rate" value={`$${plan.perMillionOverage.toFixed(2)}/M`} />
            <PlanRow label="Retention" value={`${plan.retentionDays} days`} />
          </ul>
        </div>

        {/* Quota gauge */}
        <div className="card-surface flex flex-col items-center justify-center p-5">
          <Gauge pct={usage.quotaPct} label="of included events" size={140} />
          <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center text-[11px]">
            <div>
              <div className="font-semibold tabular">{fmtNum(usage.events)}</div>
              <div className="text-[10px] text-muted-foreground">events</div>
            </div>
            <div>
              <div className="font-semibold tabular">{usage.gb} GB</div>
              <div className="text-[10px] text-muted-foreground">ingested</div>
            </div>
            <div>
              <div className="font-semibold tabular">{fmtNum(usage.insights)}</div>
              <div className="text-[10px] text-muted-foreground">insights</div>
            </div>
          </div>
          <div className="mt-2 text-[10px]" style={{ color: TONE_COLOR[quotaTone] }}>
            {usage.quotaPct > 100 ? 'overage in effect' : usage.quotaPct > 80 ? 'approaching quota' : 'healthy headroom'}
          </div>
        </div>

        {/* Projected invoice */}
        <div className="card-surface p-5">
          <SectionHeader title="Projected invoice" hint="metered + base" />
          <div className="mt-1 text-3xl font-semibold tracking-tight tabular">
            {usd(invoice.projected)}
            <span className="text-sm font-normal text-muted-foreground"> projected</span>
          </div>
          <div className="mt-4 space-y-1.5 text-[12px]">
            <InvoiceRow label="Base subscription" value={usd(invoice.base)} />
            <InvoiceRow label="Metered usage" value={usd(invoice.metered)} />
            <InvoiceRow label="Overage (events)" value={usd(invoice.overage)} strong />
            <div className="mt-2 border-t pt-2">
              <InvoiceRow label="Total due at period end" value={usd(invoice.projected)} strong />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Daily cost */}
        <div className="card-surface">
          <SectionHeader title="Daily spend" hint="last 30 days · metered cost only" right={<span className="text-[11px] tabular text-muted-foreground">~{usd(dailyCost.reduce((a, d) => a + d.cost, 0) / Math.max(1, dailyCost.length))}/day</span>} />
          <div className="px-5 pb-5 pt-1">
            <MiniBars data={dailyCost} height={72} />
            <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
              <span>{fmtDay(dailyCost[0]?.day ?? '')}</span>
              <span>{fmtDay(dailyCost[dailyCost.length - 1]?.day ?? '')}</span>
            </div>
          </div>
        </div>

        {/* Service split */}
        <div className="card-surface">
          <SectionHeader title="Cost by service" hint="attributed from usage ledger" right={<Database className="h-3.5 w-3.5 text-muted-foreground" />} />
          <div className="space-y-2.5 px-5 pb-5 pt-1">
            {services.slice(0, 6).map((s) => (
              <div key={s.key}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="font-mono">{s.key}</span>
                  <span className="tabular text-muted-foreground">
                    {usd(s.cost, 2)} · {s.share}%
                  </span>
                </div>
                <ShareBar share={s.share} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Upsell */}
      <div className="card-surface flex flex-wrap items-center gap-4 p-5">
        <Sparkles className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Need longer retention and cross-region mirroring?</div>
          <div className="text-[11px] text-muted-foreground">
            Enterprise adds {400}d retention, SSO/SAML, audit exports via the C# reporting service and priority AIOps windows.
          </div>
        </div>
        <button className="rounded-lg border px-3.5 py-1.5 text-[12px] font-medium transition-colors hover:border-ring hover:bg-accent/40">
          Compare plans
        </button>
      </div>
    </div>
  )
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Check className="h-3 w-3 text-ok" /> {label}
      </span>
      <span className="font-medium tabular">{value}</span>
    </li>
  )
}

function InvoiceRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? 'font-medium' : 'text-muted-foreground'}>{label}</span>
      <span className={strong ? 'font-semibold tabular' : 'tabular'}>{value}</span>
    </div>
  )
}
