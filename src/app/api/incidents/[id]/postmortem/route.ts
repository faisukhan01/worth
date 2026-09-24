import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { reporting } from '@/lib/upstream'
import ZAI from 'z-ai-web-dev-sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface TimelineEntry {
  ts: string
  event: string
  detail: string
}

const SYSTEM_PROMPT = `You are a staff SRE writing incident postmortems for Lodestar, an enterprise observability platform.
You will receive an incident record with its timeline, service context and (optionally) the newest SLA report summary.
Write a concise, professional postmortem in Markdown with exactly these sections:

# Postmortem - <one-line incident title>
## Summary
2-3 sentences: what happened, where, current state.
## Impact
User-facing impact and severity, quantified where the data allows (requests, error budget, availability).
## Timeline
Bulleted chronological list derived from the provided timeline entries (use their timestamps, HH:MM UTC).
## Root cause analysis
Clearly separate observed facts from inference. Label hypotheses as "probable" or "possible" - never invent certainties.
## What went well / What to improve
Two short bullet lists.
## Action items
Checklist (- [ ]) of 3-5 concrete follow-ups, each with a suggested owner role (e.g. service owner, SRE, platform).

Rules: be factual, only use provided data, keep it under 450 words, output ONLY the markdown document.`

/**
 * GET /api/incidents/:id/postmortem - return the stored postmortem markdown
 * (or null if none has been drafted yet).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // Raw read: the postmortem column was added recently and the running dev
  // server's bundled Prisma client may predate it.
  const rows = await db.$queryRaw<{ postmortem: string | null }[]>`SELECT postmortem FROM Incident WHERE id = ${id}`
  if (!rows || rows.length === 0) return NextResponse.json({ error: 'incident not found' }, { status: 404 })
  return NextResponse.json({ postmortem: rows[0].postmortem ?? null })
}

/**
 * POST /api/incidents/:id/postmortem
 * Draft a postmortem with the LLM plane from the incident's live timeline,
 * service catalog context and the newest SLA report (when one exists).
 * The markdown is persisted on the incident and a 'postmortem' timeline
 * event is appended so the audit trail shows the draft was produced.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const incident = await db.incident.findUnique({ where: { id } })
  if (!incident) return NextResponse.json({ error: 'incident not found' }, { status: 404 })

  const [service, reportData] = await Promise.all([
    db.service.findUnique({ where: { key: incident.serviceKey } }),
    reporting.reports(incident.serviceKey, 3).catch(() => null),
  ])

  let timeline: TimelineEntry[] = []
  try {
    timeline = JSON.parse(incident.timeline || '[]')
  } catch {
    timeline = []
  }
  const fmt = (iso: string) => {
    try {
      return new Date(iso).toISOString().slice(11, 16) + ' UTC'
    } catch {
      return iso
    }
  }
  const timelineText = timeline
    .slice(-30)
    .map((t) => `- ${fmt(t.ts)} · ${t.event}${t.detail ? `: ${t.detail}` : ''}`)
    .join('\n')

  const latestReport = (reportData?.reports ?? [])
    .slice()
    .sort((a, b) => (a.to < b.to ? 1 : a.to > b.to ? -1 : 0))[0]

  const parts: string[] = [
    `Incident: ${incident.title}`,
    `Service: ${incident.serviceKey}${service ? ` (${service.name}, tier ${service.tier}, owner ${service.owner}, SLO target ${service.sloTarget}%)` : ''}`,
    `Severity: ${incident.severity} · Status: ${incident.status} · Source: ${incident.source}`,
    `Started: ${fmt(incident.startedAt.toISOString())}${incident.resolvedAt ? ` · Resolved: ${fmt(incident.resolvedAt.toISOString())}` : ' · still open'}`,
    incident.assignee ? `Assignee: ${incident.assignee}` : 'Assignee: none',
    '',
    'Timeline (oldest last):',
    timelineText || '- (no timeline entries recorded)',
  ]
  if (latestReport) {
    const s = latestReport.summary
    parts.push(
      '',
      `Newest SLA report (${latestReport.from.slice(0, 10)} → ${latestReport.to.slice(0, 10)}, target ${latestReport.sloTarget}%):`,
      `availability ${s.availabilityPct}% · burn rate ${s.burnRate} · error budget remaining ${s.errorBudgetPctRemaining}% · failed requests ${s.failedRequests} of ${s.totalRequests} · total downtime ${s.totalDowntime} min`,
    )
  }

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: SYSTEM_PROMPT },
        { role: 'user', content: parts.join('\n') },
      ],
      thinking: { type: 'disabled' },
    })
    const markdown = completion.choices[0]?.message?.content?.trim()
    if (!markdown) {
      return NextResponse.json({ error: 'model returned an empty draft' }, { status: 502 })
    }

    const now = new Date()
    const stored: TimelineEntry[] = JSON.parse(incident.timeline || '[]')
    stored.push({ ts: now.toISOString(), event: 'postmortem', detail: 'AI-drafted postmortem generated from the timeline' })

    // Raw write for the postmortem column (see GET) + typed timeline update.
    await db.$executeRaw`UPDATE Incident SET postmortem = ${markdown} WHERE id = ${id}`
    await db.incident.update({
      where: { id },
      data: { timeline: JSON.stringify(stored) },
    })

    return NextResponse.json({ postmortem: markdown })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `postmortem generation failed: ${err.message}` : 'postmortem generation failed' },
      { status: 502 },
    )
  }
}
