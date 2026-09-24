import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeUrl } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/tenants/:id/sites - register a website / software endpoint
 * to monitor for the company. Body: { url, label?, kind? }
 */
export async function POST(
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

  const tenant = await db.tenant.findUnique({ where: { id } })
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const rawUrl = String(body.url ?? '').trim()
  if (!rawUrl) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  let url: string
  try {
    url = normalizeUrl(rawUrl)
  } catch {
    return NextResponse.json({ error: 'url is not valid' }, { status: 400 })
  }

  const siteCount = await db.monitoredSite.count({ where: { tenantId: id } })
  if (siteCount >= 20) {
    return NextResponse.json({ error: 'site limit reached (20) for this tenant' }, { status: 409 })
  }

  const site = await db.monitoredSite.create({
    data: {
      tenantId: id,
      url,
      label: String(body.label ?? '').trim().slice(0, 80) || 'Endpoint',
      kind: ['website', 'api', 'software'].includes(String(body.kind)) ? String(body.kind) : 'website',
    },
  })
  return NextResponse.json({ site }, { status: 201 })
}
