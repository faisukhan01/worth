import { NextRequest, NextResponse } from 'next/server'
import { API_KEY, REPORTING_URL } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

/**
 * GET /api/reports/[id]/export?format=csv|json
 * Streams the report export straight from the reporting plane. The console
 * uses it as the href of the "Export CSV" download button.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'malformed report id' }, { status: 400 })
  }
  const format = req.nextUrl.searchParams.get('format') === 'json' ? 'json' : 'csv'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const upstream = await fetch(`${REPORTING_URL}/v1/reports/sla/${id}/export?format=${format}`, {
      headers: { 'x-api-key': API_KEY, accept: format === 'csv' ? 'text/csv' : 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: 'export unavailable upstream' }, { status: 502 })
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json',
        'content-disposition': `attachment; filename="sla-report-${id}.${format}"`,
        'cache-control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'reporting plane unreachable' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}
