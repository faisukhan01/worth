'use client'

/**
 * Console chart primitives - hand-rolled SVG for full control over the
 * dense, high-signal look of the platform (no chart-library chrome).
 * All components are pure and SSR-safe.
 */

import { useMemo, useState, useId } from 'react'
import { fmtClock, fmtNum } from '@/lib/format'
import { cn } from '@/lib/utils'

const OK = 'var(--ok)'
const WARN = 'var(--warn)'
const CRIT = 'var(--crit)'
const FG = 'var(--muted-foreground)'

export interface Pt {
  ts: number
  value: number
}

// ---------------------------------------------------------------------------
// Sparkline

export function Sparkline({
  values,
  color = OK,
  height = 28,
  width = 120,
  filled = true,
}: {
  values: number[]
  color?: string
  height?: number
  width?: number
  filled?: boolean
}) {
  const gid = useId()
  const { line, area } = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' }
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const step = width / (values.length - 1)
    const pts = values.map((v, i) => {
      const x = i * step
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    const line = `M${pts.join('L')}`
    const area = `${line}L${width},${height}L0,${height}Z`
    return { line, area }
  }, [values, height, width])

  if (!line) return <svg width={width} height={height} aria-hidden />
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      {filled && <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>}
      {filled && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" style={{ stroke: color }} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Area chart with hover crosshair

export function AreaChart({
  data,
  height = 180,
  color = OK,
  unit = '',
  band,
}: {
  data: Pt[]
  height?: number
  color?: string
  unit?: string
  band?: Pt[] // optional upper band (e.g. forecast upper bound)
}) {
  const W = 600
  const H = height
  const PAD_L = 44
  const PAD_B = 20
  const [hover, setHover] = useState<number | null>(null)

  const geom = useMemo(() => {
    if (data.length < 2) return null
    const all = band?.length ? data.map((d) => d.value).concat(band.map((b) => b.value)) : data.map((d) => d.value)
    const min = Math.min(...all)
    const max = Math.max(...all)
    const span = max - min || 1
    const x = (i: number) => PAD_L + (i / (data.length - 1)) * (W - PAD_L - 8)
    const y = (v: number) => H - PAD_B - ((v - min) / span) * (H - PAD_B - 8)
    return { min, max, x, y }
  }, [data, band, H])

  if (!geom) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        waiting for telemetry…
      </div>
    )
  }

  const { min, max, x, y } = geom
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('')
  const area = `${line}L${x(data.length - 1).toFixed(1)},${H - PAD_B}L${PAD_L},${H - PAD_B}Z`
  const bandPath = band?.length
    ? `M${band.map((b, i) => `${x(Math.min(i + data.length, data.length - 1)).toFixed(1)},${y(b.value).toFixed(1)}`).join('L')}`
    : null

  const ticks = [max, min + (max - min) / 2, min]
  const hoverPt = hover !== null ? data[hover] : null

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full select-none"
        style={{ height }}
        role="img"
        aria-label="time series chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const idx = Math.round(((px - PAD_L) / (W - PAD_L - 8)) * (data.length - 1))
          setHover(Math.max(0, Math.min(data.length - 1, idx)))
        }}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} x2={W - 8} y1={y(t)} y2={y(t)} style={{ stroke: FG, strokeOpacity: 0.14 }} strokeDasharray="3 4" />
            <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize="9" style={{ fill: FG }} className="tabular">
              {fmtNum(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" style={{ stroke: color }} strokeWidth="1.8" strokeLinejoin="round" />
        {bandPath && <path d={bandPath} fill="none" style={{ stroke: color }} strokeOpacity="0.35" strokeWidth="1" strokeDasharray="4 4" />}
        {data.map((d, i) =>
          i % Math.ceil(data.length / 6) === 0 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" style={{ fill: FG }}>
              {fmtClock(d.ts).slice(0, 5)}
            </text>
          ) : null,
        )}
        {hoverPt && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={8} y2={H - PAD_B} style={{ stroke: FG }} strokeOpacity="0.35" />
            <circle cx={x(hover!)} cy={y(hoverPt.value)} r="3.5" style={{ fill: color, stroke: 'var(--card)' }} strokeWidth="1.5" />
          </g>
        )}
      </svg>
      {hoverPt && (
        <div className="pointer-events-none absolute right-2 top-1 rounded-md border bg-popover/90 px-2 py-1 text-[10px] tabular shadow-sm">
          {fmtClock(hoverPt.ts)} · {fmtNum(hoverPt.value)}{unit}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-series area chart (metrics explorer overlay)
// Up to four metrics share one plot: crosshair + tooltip read every series,
// and the legend toggles visibility without dropping them from the query.

export interface MultiSeries {
  name: string
  label: string
  color: string
  data: Pt[]
  unit?: string
  fmt?: (n: number) => string
}

export function MultiAreaChart({
  series,
  height = 240,
  scaled = true,
}: {
  series: MultiSeries[]
  height?: number
  scaled?: boolean // true: each series normalised to its own range (mixed units)
}) {
  const W = 600
  const H = height
  const PAD_L = 44
  const PAD_B = 20
  const [hoverTs, setHoverTs] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const visible = series.filter((s) => !hidden.has(s.name) && s.data.length >= 2)

  const geom = useMemo(() => {
    if (!visible.length) return null
    let tMin = Infinity
    let tMax = -Infinity
    for (const s of visible) {
      tMin = Math.min(tMin, s.data[0].ts, s.data[s.data.length - 1].ts)
      tMax = Math.max(tMax, s.data[0].ts, s.data[s.data.length - 1].ts)
    }
    if (!Number.isFinite(tMin) || tMax <= tMin) return null
    const gMin = Math.min(...visible.flatMap((s) => s.data.map((d) => d.value)))
    const gMax = Math.max(...visible.flatMap((s) => s.data.map((d) => d.value)))
    const gSpan = gMax - gMin || 1
    const x = (ts: number) => PAD_L + ((ts - tMin) / (tMax - tMin)) * (W - PAD_L - 8)
    // per-series y in scaled mode, shared y otherwise
    const yFor = (s: MultiSeries) => {
      if (!scaled) {
        return (v: number) => H - PAD_B - ((v - gMin) / gSpan) * (H - PAD_B - 10)
      }
      let sMin = Infinity
      let sMax = -Infinity
      for (const d of s.data) {
        sMin = Math.min(sMin, d.value)
        sMax = Math.max(sMax, d.value)
      }
      const span = sMax - sMin || 1
      return (v: number) => H - PAD_B - ((v - sMin) / span) * (H - PAD_B - 10)
    }
    return { tMin, tMax, x, yFor, gMin, gMax }
  }, [visible, scaled, H])

  const nearest = (data: Pt[], ts: number): Pt | null => {
    if (!data.length) return null
    let best = data[0]
    let bd = Math.abs(data[0].ts - ts)
    for (const p of data) {
      const d = Math.abs(p.ts - ts)
      if (d < bd) {
        bd = d
        best = p
      }
    }
    return best
  }

  const toggleSeries = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else if (visible.length > 1) next.add(name) // keep at least one visible
      return next
    })

  const hoverRows =
    hoverTs !== null && geom
      ? visible
          .map((s) => ({ s, pt: nearest(s.data, hoverTs) }))
          .filter((r): r is { s: MultiSeries; pt: Pt } => !!r.pt)
          .sort((a, b) => b.pt.value - a.pt.value)
      : []

  const tickVals = geom
    ? scaled
      ? [1, 0.5, 0]
      : [geom.gMax, geom.gMin + (geom.gMax - geom.gMin) / 2, geom.gMin]
    : []

  return (
    <div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full select-none"
          style={{ height }}
          role="img"
          aria-label="multi-series chart"
          onMouseLeave={() => setHoverTs(null)}
          onMouseMove={(e) => {
            if (!geom) return
            const rect = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - rect.left) / rect.width) * W
            const ratio = Math.max(0, Math.min(1, (px - PAD_L) / (W - PAD_L - 8)))
            setHoverTs(geom.tMin + ratio * (geom.tMax - geom.tMin))
          }}
        >
          <defs>
            {series.map((s) => (
              <linearGradient key={s.name} id={`multi-fill-${s.name.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.16 }} />
                <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
              </linearGradient>
            ))}
          </defs>
          {tickVals.map((t, i) => {
            const ty = scaled ? H - PAD_B - t * (H - PAD_B - 10) : geom!.yFor(visible[0])(t)
            return (
              <g key={i}>
                <line x1={PAD_L} x2={W - 8} y1={ty} y2={ty} style={{ stroke: FG, strokeOpacity: 0.14 }} strokeDasharray="3 4" />
                <text x={PAD_L - 6} y={ty + 3} textAnchor="end" fontSize="9" style={{ fill: FG }} className="tabular">
                  {scaled ? (i === 2 ? 'base' : i === 1 ? 'mid' : 'peak') : fmtNum(t)}
                </text>
              </g>
            )
          })}
          {geom &&
            visible.map((s) => {
              const y = geom.yFor(s)
              const line = s.data
                .map((d, i) => `${i === 0 ? 'M' : 'L'}${geom.x(d.ts).toFixed(1)},${y(d.value).toFixed(1)}`)
                .join('')
              const area = `${line}L${geom.x(s.data[s.data.length - 1].ts).toFixed(1)},${H - PAD_B}L${geom.x(s.data[0].ts).toFixed(1)},${H - PAD_B}Z`
              return (
                <g key={s.name}>
                  <path d={area} fill={`url(#multi-fill-${s.name.replace(/[^a-z0-9]/gi, '')})`} />
                  <path d={line} fill="none" style={{ stroke: s.color }} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              )
            })}
          {geom &&
            visible[0] &&
            (() => {
              const x0 = geom.x(visible[0].data[0].ts)
              const x1 = geom.x(visible[0].data[visible[0].data.length - 1].ts)
              const t0 = visible[0].data[0].ts
              const t1 = visible[0].data[visible[0].data.length - 1].ts
              return [t0, t0 + (t1 - t0) / 2, t1].map((t, i) => (
                <text
                  key={i}
                  x={i === 0 ? x0 : i === 1 ? (x0 + x1) / 2 : x1}
                  y={H - 6}
                  textAnchor={i === 0 ? 'start' : i === 1 ? 'middle' : 'end'}
                  fontSize="9"
                  style={{ fill: FG }}
                >
                  {fmtClock(t).slice(0, 5)}
                </text>
              ))
            })()}
          {hoverTs !== null && geom && (
            <g>
              <line x1={geom.x(hoverTs)} x2={geom.x(hoverTs)} y1={8} y2={H - PAD_B} style={{ stroke: FG }} strokeOpacity="0.35" />
              {hoverRows.map((r) => (
                <circle
                  key={r.s.name}
                  cx={geom.x(r.pt.ts)}
                  cy={geom.yFor(r.s)(r.pt.value)}
                  r="3"
                  style={{ fill: r.s.color, stroke: 'var(--card)' }}
                  strokeWidth="1.5"
                />
              ))}
            </g>
          )}
        </svg>
        {hoverRows.length > 0 && (
          <div className="pointer-events-none absolute right-2 top-1 rounded-md border bg-popover/90 px-2 py-1.5 text-[10px] tabular shadow-sm">
            <div className="mb-1 text-muted-foreground">{fmtClock(hoverRows[0].pt.ts)}</div>
            {hoverRows.map((r) => (
              <div key={r.s.name} className="flex items-center gap-1.5 leading-tight">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.s.color }} />
                <span className="text-muted-foreground">{r.s.label}</span>
                <span className="ml-auto font-medium">
                  {r.s.fmt ? r.s.fmt(r.pt.value) : fmtNum(r.pt.value)}
                  {r.s.unit ?? ''}
                </span>
              </div>
            ))}
          </div>
        )}
        {!geom && (
          <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
            waiting for telemetry…
          </div>
        )}
      </div>
      {/* legend / visibility toggles */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 pb-2 pt-1">
        {series.map((s) => {
          const off = hidden.has(s.name)
          const latest = s.data.length ? s.data[s.data.length - 1].value : null
          return (
            <button
              key={s.name}
              onClick={() => toggleSeries(s.name)}
              aria-pressed={!off}
              className={cn(
                'flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] transition-opacity hover:bg-muted/40',
                off && 'opacity-40',
              )}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: s.color, opacity: off ? 0.4 : 1 }} />
              <span className={cn('text-muted-foreground', off && 'line-through')}>{s.label}</span>
              {latest !== null && !off && (
                <span className="font-medium tabular">
                  {s.fmt ? s.fmt(latest) : fmtNum(latest)}
                  {s.unit ?? ''}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Uptime ribbon (90-day status-page style)

export function UptimeRibbon({ values, target }: { values: number[]; target: number }) {
  const colorFor = (v: number) => (v >= target ? OK : v >= target - 0.5 ? WARN : CRIT)
  return (
    <div className="flex items-end gap-[2px]" title="last 90 days uptime">
      {values.map((v, i) => (
        <div
          key={i}
          className="h-4 w-1 rounded-[1px] transition-transform hover:scale-y-125"
          style={{ background: colorFor(v), opacity: 0.35 + (i / values.length) * 0.65 }}
          title={`${v.toFixed(3)}%`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quota gauge

export function Gauge({ pct, label, size = 120 }: { pct: number; label?: string; size?: number }) {
  const clamped = Math.max(0, Math.min(150, pct))
  const color = clamped > 100 ? CRIT : clamped > 80 ? WARN : OK
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const arc = (Math.min(clamped, 100) / 100) * c
  const overflow = Math.max(0, clamped - 100)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label ?? 'quota'} ${pct}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: FG, strokeOpacity: 0.15 }} strokeWidth="9" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${arc} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      {overflow > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          style={{ stroke: CRIT }}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${(Math.min(overflow, 50) / 100) * c} ${c}`}
          strokeOpacity="0.85"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
      <text x="50%" y="47%" textAnchor="middle" fontSize="20" fontWeight="600" style={{ fill: 'var(--foreground)' }} className="tabular">
        {pct.toFixed(0)}%
      </text>
      {label && (
        <text x="50%" y="63%" textAnchor="middle" fontSize="9" style={{ fill: FG }}>
          {label}
        </text>
      )}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Horizontal share bars (billing split)

export function ShareBar({ share, color = OK }: { share: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, share)}%`, background: color }} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini bar series (daily cost)

export function MiniBars({ data, height = 56 }: { data: { day: string; cost: number }[]; height?: number }) {
  const max = Math.max(...data.map((d) => d.cost), 0.01)
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.slice(-30).map((d, i) => (
        <div
          key={i}
          className="group relative flex-1 rounded-t-[2px]"
          style={{ height: `${Math.max(4, (d.cost / max) * 100)}%`, background: `color-mix(in oklch, ${OK} ${45 + (d.cost / max) * 55}%, transparent)` }}
          title={`${d.day}: $${d.cost.toFixed(2)}`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confidence bar

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const color = pct >= 75 ? CRIT : pct >= 50 ? WARN : OK
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] tabular text-muted-foreground">{pct}%</span>
    </div>
  )
}
