import { randomBytes } from 'crypto'

/**
 * Shared helpers for the admin / tenant onboarding surface.
 *
 * Tenant ingest keys use the gateway-compatible `pg_live_` prefix so an
 * operator can activate them by adding the secret to the gateway's
 * API_KEYS allow-list (services/ingest-gateway, env API_KEYS). The full
 * secret is stored (needed for activation) but only the masked form is
 * ever returned by list endpoints; the raw secret leaves the API exactly
 * once - in the POST response that created it.
 */

const KEY_PREFIX = 'pg_live_'

/** Generate a full ingest secret: pg_live_<16 hex>.<8 hex> */
export function generateTenantKey(): string {
  return `${KEY_PREFIX}${randomBytes(8).toString('hex')}.${randomBytes(4).toString('hex')}`
}

/** Masked display form: pg_live_9f2a…1b03 (safe to show any time). */
export function maskKey(secret: string): string {
  if (secret.length <= 14) return secret
  return `${secret.slice(0, 12)}…${secret.slice(-4)}`
}

/** Mask a credential value, revealing only the last 4 characters. */
export function maskSecret(secret: string): string {
  if (secret.length <= 8) return '••••'
  return `••••••••${secret.slice(-4)}`
}

/** URL-safe unique slug from a company name, e.g. "Acme Corp!" -> "acme-corp". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'tenant'
  )
}

/** Parse and normalize a website/endpoint URL; throws on invalid input. */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const parsed = new URL(withScheme)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must be http(s)')
  }
  return parsed.toString()
}

/** True when the HTTP status counts as "site up" (any non-5xx response). */
export function isUpStatus(status: number): boolean {
  return status < 500
}
