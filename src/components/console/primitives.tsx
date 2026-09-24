'use client'

import { cn } from '@/lib/utils'

export type StatusTone = 'ok' | 'warn' | 'crit' | 'neutral'

export const TONE_COLOR: Record<StatusTone, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  crit: 'var(--crit)',
  neutral: 'var(--muted-foreground)',
}

export function statusTone(status: string): StatusTone {
  switch (status) {
    case 'healthy':
    case 'resolved':
    case 'ok':
    case 'mitigated':
      return 'ok'
    case 'degraded':
    case 'acknowledged':
    case 'warning':
    case 'warn':
      return 'warn'
    case 'critical':
    case 'triggered':
    case 'error':
    case 'fatal':
      return 'crit'
    default:
      return 'neutral'
  }
}

export function StatusPill({
  status,
  label,
  className,
}: {
  status: string
  label?: string
  className?: string
}) {
  const tone = statusTone(status)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        className,
      )}
      style={{
        color: TONE_COLOR[tone],
        borderColor: `color-mix(in oklch, ${TONE_COLOR[tone]} 35%, transparent)`,
        background: `color-mix(in oklch, ${TONE_COLOR[tone]} 10%, transparent)`,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
      {label ?? status}
    </span>
  )
}

export function LiveDot({ tone = 'ok' as StatusTone, className }: { tone?: StatusTone; className?: string }) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)} aria-hidden>
      <span
        className="live-dot absolute inline-flex h-full w-full rounded-full"
        style={{ background: TONE_COLOR[tone] }}
      />
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: TONE_COLOR[tone], opacity: 0.9 }}
      />
    </span>
  )
}

export function SectionHeader({
  title,
  hint,
  right,
}: {
  title: string
  hint?: string
  right?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {right}
    </div>
  )
}

export function KpiTile({
  label,
  value,
  sub,
  spark,
  tone = 'neutral',
  className,
}: {
  label: string
  value: string
  sub?: string
  spark?: React.ReactNode
  tone?: StatusTone
  className?: string
}) {
  return (
    <div className={cn('card-surface group relative overflow-hidden p-4', className)}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {tone !== 'neutral' && (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: TONE_COLOR[tone] }} />
        )}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div>
          <div className="text-[22px] font-semibold leading-none tracking-tight tabular">{value}</div>
          {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
        </div>
        {spark && <div className="shrink-0 opacity-80 transition-opacity group-hover:opacity-100">{spark}</div>}
      </div>
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      {hint && <div className="text-xs text-muted-foreground/70">{hint}</div>}
    </div>
  )
}
