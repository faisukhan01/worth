import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/alerts/rules/:id - arm or mute an alert rule.
 * Body: { enabled: boolean }
 * Muted rules stay listed but are skipped by the background evaluator and
 * test-fire buttons keep working (they are read-only evaluations).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: "provide { enabled: boolean }" }, { status: 400 })
  }

  const existing = await db.alertRule.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'rule not found' }, { status: 404 })

  const rule = await db.alertRule.update({
    where: { id },
    data: { enabled: body.enabled },
  })

  // Disarming a rule also cleans up its untouched auto-fired incident so the
  // register does not keep showing a breach the operator explicitly muted.
  if (!body.enabled) {
    const open = await db.incident.findFirst({
      where: { dedupKey: `rule:${id}`, status: 'triggered' },
    })
    if (open) {
      const timeline: { ts: string; event: string; detail: string }[] = JSON.parse(open.timeline || '[]')
      const now = new Date()
      timeline.push({ ts: now.toISOString(), event: 'resolved', detail: 'auto-resolved · rule muted by operator' })
      await db.incident.update({
        where: { id: open.id },
        data: { status: 'resolved', resolvedAt: now, timeline: JSON.stringify(timeline) },
      })
    }
  }

  return NextResponse.json({ rule })
}
