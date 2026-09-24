'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ConsoleShell } from '@/components/console/console-shell'
import { useConsole } from '@/store/console-store'
import { OverviewView } from '@/components/console/views/overview'
import { ServicesView } from '@/components/console/views/services'
import { MetricsView } from '@/components/console/views/metrics'
import { LogsView } from '@/components/console/views/logs'
import { AlertsView } from '@/components/console/views/alerts'
import { AiopsView } from '@/components/console/views/aiops'
import { BillingView } from '@/components/console/views/billing'
import { SettingsView } from '@/components/console/views/settings'

export default function Home() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 3_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  )
  const view = useConsole((s) => s.view)

  return (
    <QueryClientProvider client={client}>
      <ConsoleShell>
        <RenderView view={view} />
      </ConsoleShell>
    </QueryClientProvider>
  )
}

function RenderView({ view }: { view: string }) {
  switch (view) {
    case 'services':
      return <ServicesView />
    case 'metrics':
      return <MetricsView />
    case 'logs':
      return <LogsView />
    case 'alerts':
      return <AlertsView />
    case 'aiops':
      return <AiopsView />
    case 'billing':
      return <BillingView />
    case 'settings':
      return <SettingsView />
    default:
      return <OverviewView />
  }
}
