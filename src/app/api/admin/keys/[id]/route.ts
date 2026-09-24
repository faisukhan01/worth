import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** DELETE /api/admin/keys/:id - revoke a tenant ingest key (idempotent). */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const key = await db.tenantKey.findUnique({ where: { id } })
  if (!key) return NextResponse.json({ error: 'key not found' }, { status: 404 })
  await db.tenantKey.update({ where: { id }, data: { revoked: true } })
  return NextResponse.json({ revoked: true, id })
}
