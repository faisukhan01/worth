import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/settings - team roster, on-call state and platform identity
 * for the Settings view.
 */
export async function GET() {
  const [team, services] = await Promise.all([
    db.teamMember.findMany({ orderBy: [{ onCall: 'desc' }, { name: 'asc' }] }),
    db.service.findMany({ select: { key: true, name: true, owner: true, tier: true } }),
  ])
  return NextResponse.json({
    team,
    services,
    platform: {
      name: 'Lodestar',
      org: 'Acme Corporation',
      region: 'us-east-1 (primary)',
      dataPlane: 'ingest-gateway (Go) :3100',
      intelligencePlane: 'aiops-engine (Python) :3200',
      billingCore: 'billing-core (Java) :4100',
      reporting: 'reporting (C#) :4200',
      edgeAgent: 'pulseagent (C)',
    },
  })
}
