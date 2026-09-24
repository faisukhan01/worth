import { NextRequest, NextResponse } from 'next/server'
import { fetchJson, REPORTING_URL, API_KEY, TIMEOUT_MS } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/[id]
 * Fetches one persisted SLA report from the reporting plane.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'malformed report id' }, { status: 400 })
  }
  const report = await fetchJson<unknown>(`${REPORTING_URL}/v1/reports/${id}`, TIMEOUT_MS, {
    headers: { 'x-api-key': API_KEY },
  })
  if (!report) {
    return NextResponse.json({ error: 'report not found or reporting plane unavailable' }, { status: 502 })
  }
  return NextResponse.json(report)
}
