import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** DELETE /api/admin/credentials/:id - remove a stored integration credential. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const credential = await db.tenantCredential.findUnique({ where: { id } })
  if (!credential) return NextResponse.json({ error: 'credential not found' }, { status: 404 })
  await db.tenantCredential.delete({ where: { id } })
  return NextResponse.json({ deleted: true, id })
}
