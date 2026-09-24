import { NextRequest, NextResponse } from 'next/server'
import { GATEWAY_URL, API_KEY } from '@/lib/upstream'

export const dynamic = 'force-dynamic'

/**
 * GET /api/logs/stream
 *
 * Server-side proxy for the gateway's SSE fan-out (`GET /v1/stream`, Go
 * :3100). The browser cannot authenticate against the gateway directly (it
 * requires the x-api-key header, which EventSource cannot set), so this route
 * forwards the byte stream after attaching the key server-side.
 *
 * Events surfaced to the client (unchanged wire format):
 *   event: log        data: {"type":"log","data":{"level","service","message","ts"}}
 *   event: heartbeat  data: {"type":"heartbeat","ts","stats":{series_active,agents,rps}}
 */
export async function GET(req: NextRequest) {
  let upstream: Response
  try {
    upstream = await fetch(`${GATEWAY_URL}/v1/stream`, {
      headers: { 'x-api-key': API_KEY, accept: 'text/event-stream' },
      signal: req.signal, // aborts upstream when the client disconnects
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json(
      { error: 'ingest gateway unreachable' },
      { status: 502 },
    )
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `gateway stream refused (${upstream.status})` },
      { status: 502 },
    )
  }

  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // disable proxy/response buffering so events land immediately
      'x-accel-buffering': 'no',
    },
  })
}
