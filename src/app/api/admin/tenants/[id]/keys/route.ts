import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateTenantKey, maskKey } from '@/lib/admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/tenants/:id/keys - provision another ingest API key for a
 * company. Body: { label? } - the FULL secret is returned exactly once.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  let label = 'ingest'
  try {
    const body = (await req.json()) as Record<string, unknown>
    label = String(body.label ?? '').trim().slice(0, 60) || 'ingest'
  } catch {
    // empty body is fine - default label
  }

  const tenant = await db.tenant.findUnique({ where: { id } })
  if (!tenant) return NextResponse.json({ error: 'tenant not found' }, { status: 404 })

  const activeCount = await db.tenantKey.count({ where: { tenantId: id, revoked: false } })
  if (activeCount >= 10) {
    return NextResponse.json({ error: 'key limit reached (10 active) - revoke one first' }, { status: 409 })
  }

  const secret = generateTenantKey()
  const key = await db.tenantKey.create({
    data: { tenantId: id, label, secret, prefix: secret.slice(0, 12) },
  })

  return NextResponse.json(
    {
      key: {
        id: key.id,
        label: key.label,
        prefix: key.prefix,
        masked: maskKey(key.secret),
        revoked: key.revoked,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
      },
      secret, // shown once, never again
    },
    { status: 201 },
  )
}
