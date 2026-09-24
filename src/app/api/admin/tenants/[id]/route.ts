import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const PLANS = ['starter', 'growth', 'scale', 'enterprise']

/**
 * PATCH /api/admin/tenants/:id - update company profile / plan / status.
 * Body: { name?, contact?, plan?, status?, notes? } (all optional)
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

  const existing = await db.tenant.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const data: Record<string, string> = {}
  if ('name' in body) {
    const name = String(body.name ?? '').trim()
    if (name.length < 2) return NextResponse.json({ error: 'name too short' }, { status: 400 })
    data.name = name
  }
  if ('contact' in body) {
    const contact = String(body.contact ?? '').trim().slice(0, 120)
    if (contact && !contact.includes('@')) {
      return NextResponse.json({ error: 'contact must be an email address' }, { status: 400 })
    }
    data.contact = contact
  }
  if ('plan' in body) {
    if (!PLANS.includes(String(body.plan))) {
      return NextResponse.json({ error: 'plan must be starter|growth|scale|enterprise' }, { status: 400 })
    }
    data.plan = String(body.plan)
  }
  if ('status' in body) {
    if (!['active', 'suspended'].includes(String(body.status))) {
      return NextResponse.json({ error: 'status must be active|suspended' }, { status: 400 })
    }
    data.status = String(body.status)
  }
  if ('notes' in body) data.notes = String(body.notes ?? '').trim().slice(0, 500)

  const tenant = await db.tenant.update({ where: { id }, data })
  return NextResponse.json({ tenant })
}

/** DELETE /api/admin/tenants/:id - remove the company and everything under it. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const existing = await db.tenant.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })
  await db.tenant.delete({ where: { id } }) // cascades keys, sites, credentials
  return NextResponse.json({ deleted: true, id })
}
