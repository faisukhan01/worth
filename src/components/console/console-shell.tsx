'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, BrainCircuit, CreditCard, LayoutDashboard, ScrollText,
  Settings, Siren, Boxes, Search, RefreshCw, ChevronRight,
  CircleHelp, Radar, FileBarChart, Sun, Moon, ShieldCheck,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Command, CommandDialog, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { VIEWS, useConsole, type ViewKey } from '@/store/console-store'
import { LiveDot } from '@/components/console/primitives'
import { cn } from '@/lib/utils'

const VIEW_ICONS: Record<ViewKey, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  services: Boxes,
  metrics: Activity,
  logs: ScrollText,
  alerts: Siren,
  aiops: BrainCircuit,
  billing: CreditCard,
  reports: FileBarChart,
  settings: Settings,
}

/** Hydration guard without setState-in-effect (lint-clean useSyncExternalStore idiom). */
const emptySubscribe = () => () => {}
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useMounted()

  const isDark = mounted && resolvedTheme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark
        ? <Sun className="h-4 w-4" />
        : <Moon className={cn('h-4 w-4', !mounted && 'opacity-0')} />}
    </Button>
  )
}

interface HealthPayload {
  status: string
  planes: { gateway: boolean; aiops: boolean; database: boolean; billing: boolean; reporting: boolean }
  codeTier: boolean
  latencyMs: number
  version: string
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const { view, setView } = useConsole()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [now, setNow] = useState('')

  const { data: health, refetch, isRefetching } = useQuery({
    queryKey: ['shell-health'],
    queryFn: async (): Promise<HealthPayload> => {
      const res = await fetch('/api/health', { cache: 'no-store' })
      return res.json()
    },
    refetchInterval: 20_000,
  })

  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString('en-GB', { hour12: false })), 1000)
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const tone = !health
    ? 'neutral'
    : health.status === 'ok'
      ? health.codeTier ? 'ok' : 'warn' // core green, code tier down
      : 'crit'

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen bg-background text-foreground">
        {/* Sidebar ------------------------------------------------------ */}
        <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col border-r bg-sidebar md:flex">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <LodestarMark className="h-7 w-7" />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">Lodestar</div>
              <div className="text-[10px] text-muted-foreground">Observability · AIOps</div>
            </div>
          </div>

          <nav className="mt-1 flex-1 space-y-0.5 px-2" aria-label="console views">
            {VIEWS.map((v) => {
              const Icon = VIEW_ICONS[v.key]
              const active = view === v.key
              return (
                <button
                  key={v.key}
                  onClick={() => setView(v.key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                    active
                      ? 'bg-accent font-medium text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
                  )}
                  <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                  <span className="flex-1">{v.label}</span>
                  {active && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </button>
              )
            })}
          </nav>

          {/* Sidebar footer: upstream planes */}
          <div className="mx-3 mb-3 rounded-lg border bg-card/60 p-3">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Data planes
            </div>
            <PlaneRow name="Ingest gateway" tech="Go" up={health?.planes.gateway} />
            <PlaneRow name="AIOps engine" tech="Python" up={health?.planes.aiops} />
            <PlaneRow name="Billing core" tech="Java" up={health?.planes.billing} />
            <PlaneRow name="Reporting" tech="C#" up={health?.planes.reporting} />
            <PlaneRow name="Control store" tech="SQLite" up={health?.planes.database} />
          </div>
        </aside>

        {/* Main --------------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:px-6">
            <div className="flex items-center gap-2 md:hidden">
              <LodestarMark className="h-6 w-6" />
            </div>

            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden h-8 w-64 items-center gap-2 rounded-md border bg-card/50 px-2.5 text-xs text-muted-foreground transition-colors hover:border-ring sm:flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Search views…</span>
              <kbd className="ml-auto rounded border bg-muted px-1 font-mono text-[9px]">⌘K</kbd>
            </button>

            <div className="ml-auto flex items-center gap-3">
              {/* Admin panel entry point (company onboarding, keys, endpoints) */}
              <Button
                variant={view === 'admin' ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-8 gap-1.5 text-xs',
                  view === 'admin' && 'font-medium text-primary',
                )}
                aria-label="Open admin panel"
                onClick={() => setView(view === 'admin' ? 'overview' : 'admin')}
              >
                <ShieldCheck className="h-4 w-4" />
                <span className="hidden sm:inline">Admin</span>
              </Button>

              <div className="hidden items-center gap-1.5 rounded-full border bg-card/60 px-2.5 py-1 text-[11px] text-muted-foreground sm:flex">
                <Radar className="h-3 w-3 text-primary" />
                <span className="tabular">{now || '--:--:--'}</span>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void refetch()} aria-label="refresh health">
                    <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Refresh plane status</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <ThemeToggle />
                </TooltipTrigger>
                <TooltipContent>Toggle light / dark theme</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="help">
                    <CircleHelp className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="text-xs leading-relaxed">
                    Gateway <code className="font-mono">:3100</code> · AIOps <code className="font-mono">:3200</code>
                    <br />
                    Billing <code className="font-mono">:4100</code> · Reporting <code className="font-mono">:4200</code>
                  </div>
                </TooltipContent>
              </Tooltip>

              {/* On-call avatar stack */}
              <div className="hidden items-center -space-x-1.5 sm:flex" aria-label="on-call engineers">
                {['AO', 'KT'].map((ini, i) => (
                  <div
                    key={ini}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border-2 border-background text-[9px] font-bold text-primary-foreground',
                      i === 0 ? 'bg-primary' : 'bg-secondary text-secondary-foreground',
                    )}
                  >
                    {ini}
                  </div>
                ))}
                <span className="ml-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <LiveDot tone="ok" /> on-call
                </span>
              </div>
            </div>
          </header>

          {/* View content */}
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>

          {/* Sticky footer (mt-auto pins it on short views) */}
          <footer className="mt-auto border-t bg-card/40">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5 text-[11px] text-muted-foreground md:px-6">
              <span className="flex items-center gap-1.5">
                <LiveDot tone={tone as 'ok' | 'warn' | 'crit' | 'neutral'} />
                <span className="font-medium text-foreground/80">
                  {health
                    ? health.status === 'ok'
                      ? health.codeTier
                        ? 'All systems operational'
                        : 'Core operational · code tier offline'
                      : 'Partial degradation'
                    : 'checking…'}
                </span>
              </span>
              <span>gateway {health?.planes.gateway ? '✓' : '×'} :3100</span>
              <span>aiops {health?.planes.aiops ? '✓' : '×'} :3200</span>
              <span className="hidden md:inline">billing {health?.planes.billing ? '✓' : '×'} :4100</span>
              <span className="hidden md:inline">reporting {health?.planes.reporting ? '✓' : '×'} :4200</span>
              <span className="ml-auto hidden sm:inline">Lodestar v{health?.version ?? '0.1.0'} · us-east-1 · probe {health?.latencyMs ?? '—'}ms</span>
            </div>
          </footer>
        </div>

        {/* Command palette ---------------------------------------------- */}
        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <CommandInput placeholder="Jump to a view…" />
          <CommandList>
            <Command empty="No views match.">
              <CommandList>
                {VIEWS.map((v) => {
                  const Icon = VIEW_ICONS[v.key]
                  return (
                    <CommandItem
                      key={v.key}
                      value={v.label}
                      onSelect={() => {
                        setView(v.key)
                        setPaletteOpen(false)
                      }}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      <span>{v.label}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{v.hint}</span>
                    </CommandItem>
                  )
                })}
                <CommandItem
                  value="Admin"
                  onSelect={() => {
                    setView('admin')
                    setPaletteOpen(false)
                  }}
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  <span>Admin</span>
                  <span className="ml-auto text-xs text-muted-foreground">Companies &amp; keys</span>
                </CommandItem>
              </CommandList>
            </Command>
          </CommandList>
        </CommandDialog>
      </div>
    </TooltipProvider>
  )
}

function PlaneRow({ name, tech, up }: { name: string; tech: string; up?: boolean }) {
  const tone = up === undefined ? 'neutral' : up ? 'ok' : 'crit'
  return (
    <div className="flex items-center justify-between py-0.5 text-[11px]">
      <span className="flex items-center gap-1.5 text-foreground/80">
        <LiveDot tone={tone as 'ok' | 'crit' | 'neutral'} />
        {name}
      </span>
      <span className="rounded border bg-muted/50 px-1 font-mono text-[9px] text-muted-foreground">{tech}</span>
    </div>
  )
}

export function LodestarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" style={{ fill: 'var(--card)', stroke: 'var(--border)' }} />
      <path d="M16 5 L19.2 12.8 L27 16 L19.2 19.2 L16 27 L12.8 19.2 L5 16 L12.8 12.8 Z" style={{ fill: 'var(--primary)' }} />
      <circle cx="16" cy="16" r="2.1" style={{ fill: 'var(--background)' }} />
    </svg>
  )
}
