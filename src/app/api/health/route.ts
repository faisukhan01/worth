import { NextResponse } from 'next/server'
import { upstreamHealth } from '@/lib/upstream'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Platform health probe used by the console footer, load balancers and CI
 * smoke checks. Reports each plane independently:
 *  - data plane         Go ingest-gateway  (:3100)
 *  - intelligence plane Python AIOps engine (:3200)
 *  - control plane      SQLite via Prisma
 *  - code tier          Java billing-core  (:4100) · C# reporting (:4200)
 *
 * Overall status tracks the core planes; the code tier is reported as a
 * flag so partial degradation is visible without paging anyone.
 */
export async function GET() {
  const began = Date.now()
  const [upstreams, org] = await Promise.all([
    upstreamHealth(),
    db.service.count().catch(() => -1),
  ])
  const core = upstreams.gateway && upstreams.aiops && org > 0
  const codeTier = upstreams.billing && upstreams.reporting
  return NextResponse.json(
    {
      status: core ? 'ok' : 'degraded',
      service: 'lodestar-web',
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
      planes: { ...upstreams, database: org >= 0, seededServices: org },
      codeTier,
      latencyMs: Date.now() - began,
    },
    { status: core ? 200 : 503 },
  )
}
