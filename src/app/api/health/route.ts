import { NextResponse } from 'next/server'
import { upstreamHealth } from '@/lib/upstream'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Platform health probe used by the console footer, load balancers and CI
 * smoke checks. Reports each plane independently: data plane (Go gateway),
 * intelligence plane (Python AIOps) and control plane (SQLite via Prisma).
 */
export async function GET() {
  const began = Date.now()
  const [upstreams, org] = await Promise.all([
    upstreamHealth(),
    db.service.count().catch(() => -1),
  ])
  const healthy = upstreams.gateway && upstreams.aiops && org > 0
  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'lodestar-web',
      version: process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0',
      planes: { ...upstreams, database: org >= 0, seededServices: org },
      latencyMs: Date.now() - began,
    },
    { status: healthy ? 200 : 503 },
  )
}
