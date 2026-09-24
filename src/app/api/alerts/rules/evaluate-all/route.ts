import { NextResponse } from 'next/server'
import { runSweep, lastSweep, sweepInProgress } from '@/lib/rule-evaluator'

export const dynamic = 'force-dynamic'

/**
 * GET /api/alerts/rules/evaluate-all
 * Status of the background evaluator: the last sweep summary (or null before
 * the first pass) plus whether a sweep is running right now.
 */
export async function GET() {
  return NextResponse.json({
    last: lastSweep(),
    inProgress: sweepInProgress(),
  })
}

/**
 * POST /api/alerts/rules/evaluate-all
 * Trigger a sweep immediately: every enabled rule is evaluated and breaches
 * are promoted into real incidents (dedupKey rule:<id>). Cleared conditions
 * auto-resolve untouched rule-fired incidents. Safe to call concurrently -
 * overlapping sweeps collapse into the in-progress one.
 */
export async function POST() {
  const sweep = await runSweep()
  return NextResponse.json(sweep)
}
