import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const KINDS = ['webhook', 'slack', 'custom']

/**
 * POST /api/admin/tenants/:id/credentials - store an integration credential
 * for the company (alert webhook, Slack incoming webhook, vendor key...).
 * Body: { name, value, kind? } - value is stored server-side, only a masked
 * form is ever returned by list endpoints.
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

  const name = String(body.name ?? '').trim().slice(0, 80)
  const value = String(body.value ?? '').trim()
  if (name.length < 2) return NextResponse.json({ error: 'credential name too short' }, { status: 400 })
  if (value.length < 8) return NextResponse.json({ error: 'credential value too short' }, { status: 400 })

  const count = await db.tenantCredential.count({ where: { tenantId: id } })
  if (count >= 10) {
    return NextResponse.json({ error: 'credential limit reached (10) for this tenant' }, { status: 409 })
  }

  const credential = await db.tenantCredential.create({
    data: {
      tenantId: id,
      name,
      secret: value,
      kind: KINDS.includes(String(body.kind)) ? String(body.kind) : 'custom',
    },
  })
  return NextResponse.json(
    {
      credential: {
        id: credential.id,
        kind: credential.kind,
        name: credential.name,
        masked: '••••••••' + credential.secret.slice(-4),
        createdAt: credential.createdAt,
      },
    },
    { status: 201 },
  )
}
