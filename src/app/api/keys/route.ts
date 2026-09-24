import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

function newPrefix(env: string): string {
  const head = env === 'staging' ? 'pg_live_stg' : env === 'development' ? 'pg_test' : 'pg_live'
  const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0') // #nosec -- display prefix only
  return `${head}_${hex()}${hex()}`
}

/**
 * GET /api/keys - masked API key inventory.
 * POST /api/keys - provision { name, env }.
 * DELETE /api/keys?id= - revoke.
 *
 * Demo tier: keys are stored display-only; production provisioning flows
 * through billing-core and propagates to the gateway's API_KEYS allow-list.
 */
export async function GET() {
  const keys = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    keys: keys.map((k) => ({
      ...k,
      masked: `${k.prefix.slice(0, 11)}${'\u2022'.repeat(8)}`,
    })),
  })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const name = String(body.name ?? '').trim().slice(0, 60)
  const env = ['production', 'staging', 'development'].includes(String(body.env))
    ? String(body.env)
    : 'production'
  if (name.length < 3) {
    return NextResponse.json({ error: 'name must be at least 3 characters' }, { status: 400 })
  }
  const key = await db.apiKey.create({ data: { name, env, prefix: newPrefix(env) } })
  return NextResponse.json({ key }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const existing = await db.apiKey.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })
  await db.apiKey.update({ where: { id }, data: { revoked: true } })
  return NextResponse.json({ ok: true })
}
