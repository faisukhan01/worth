import { NextRequest, NextResponse } from 'next/server'
import { aiops } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

/**
 * GET /api/aiops
 * Proxy to the Python AIOps engine. Anomalies carry baseline/observed/score
 * for full auditability; forecasts include prediction bands.
 */
export async function GET() {
  const data = await aiops.insights()
  if (!data) {
    return NextResponse.json(
      {
        error: 'aiops-engine unavailable',
        anomalies: [],
        forecasts: [],
        health: [],
        summary: { overall_status: 'unknown', engine_warm: false },
      },
      { status: 502 },
    )
  }
  return NextResponse.json(data)
}
