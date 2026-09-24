import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateTenantKey, maskKey, slugify, normalizeUrl } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const PLANS = ['starter', 'growth', 'scale', 'enterprise']

/**
 * GET /api/admin/tenants - list every registered company with its keys
 * (masked), monitored sites and integration credentials.
 */
export async function GET() {
  const tenants = await db.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      keys: { orderBy: { createdAt: 'desc' } },
      sites: { orderBy: { createdAt: 'asc' } },
      credentials: { orderBy: { createdAt: 'desc' } },
    },
  })

  return NextResponse.json({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      contact: t.contact,
      plan: t.plan,
      status: t.status,
      notes: t.notes,
      createdAt: t.createdAt,
      keys: t.keys.map((k) => ({
        id: k.id,
        label: k.label,
        prefix: k.prefix,
        masked: maskKey(k.secret),
        revoked: k.revoked,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
      })),
      sites: t.sites,
      credentials: t.credentials.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        masked: c.secret.slice(0, 2) + '••••' + c.secret.slice(-4),
        createdAt: c.createdAt,
      })),
    })),
  })
}

/**
 * POST /api/admin/tenants - register a company on the platform.
 * Body: { name, contact?, plan?, notes?, website?: { label?, url, kind? } }
 * A first ingest API key is provisioned automatically and its FULL secret is
 * returned once (response key `firstKey.secret`).
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const name = String(body.name ?? '').trim()
  if (name.length < 2) {
    return NextResponse.json({ error: 'company name must be at least 2 characters' }, { status: 400 })
  }
  const contact = String(body.contact ?? '').trim().slice(0, 120)
  if (contact && !contact.includes('@')) {
    return NextResponse.json({ error: 'contact must be an email address' }, { status: 400 })
  }
  const plan = PLANS.includes(String(body.plan)) ? String(body.plan) : 'starter'
  const notes = String(body.notes ?? '').trim().slice(0, 500)

  let website: { label: string; url: string; kind: string } | null = null
  if (body.website && typeof body.website === 'object') {
    const w = body.website as Record<string, unknown>
    const rawUrl = String(w.url ?? '').trim()
    if (rawUrl) {
      try {
        website = {
          url: normalizeUrl(rawUrl),
          label: String(w.label ?? '').trim().slice(0, 80) || 'Primary site',
          kind: ['website', 'api', 'software'].includes(String(w.kind)) ? String(w.kind) : 'website',
        }
      } catch {
        return NextResponse.json({ error: 'website url is not valid' }, { status: 400 })
      }
    }
  }

  // unique slug with numeric suffix when needed
  const base = slugify(name)
  let slug = base
  for (let i = 2; (await db.tenant.findUnique({ where: { slug } })) !== null; i++) slug = `${base}-${i}`

  const secret = generateTenantKey()
  const tenant = await db.tenant.create({
    data: {
      name,
      slug,
      contact,
      plan,
      notes,
      keys: {
        create: {
          label: 'default ingest',
          secret,
          prefix: secret.slice(0, 12),
        },
      },
      sites: website ? { create: website } : undefined,
    },
    include: { keys: true, sites: true, credentials: true },
  })

  const firstKey = tenant.keys[0]
  return NextResponse.json(
    {
      tenant: {
        ...tenant,
        keys: tenant.keys.map((k) => ({
          id: k.id,
          label: k.label,
          prefix: k.prefix,
          masked: maskKey(k.secret),
          revoked: k.revoked,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
        })),
      },
      firstKey: { id: firstKey.id, label: firstKey.label, secret }, // full secret shown once
    },
    { status: 201 },
  )
}
