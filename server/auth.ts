import { badRequest, unauthorized } from './errors'
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWTPayload,
} from 'jose'

export interface HumanPrincipal {
  kind: 'human'
  issuer: string
  subject: string
  email: string | null
  scopes: string[]
}

export interface AgentPrincipal {
  kind: 'agent'
  owner: { issuer: string; subject: string }
  agent: { issuer: string; subject: string }
  scopes: string[]
}

function bearer(request: Request, scheme: 'Bearer' | 'DPoP') {
  const value = request.headers.get('authorization')
  const match = value?.match(new RegExp(`^${scheme}\\s+(.+)$`, 'i'))
  if (!match?.[1]) {
    throw scheme === 'DPoP'
      ? agentUnauthorized('DPoP access token is required.')
      : unauthorized('Bearer access token is required.')
  }
  return match[1]
}

function scopes(payload: JWTPayload) {
  return typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : []
}

function requireScope(values: string[], required: string) {
  if (!values.includes(required)) throw unauthorized(`The ${required} scope is required.`)
}

export async function authenticateHuman(request: Request, env: Env, requiredScope: string): Promise<HumanPrincipal> {
  const rawToken = bearer(request, 'Bearer')
  const jwks = await keySet(env)
  const { payload } = await jwtVerify(rawToken, jwks, {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_AUDIENCE,
    algorithms: ['EdDSA', 'ES256', 'RS256'],
  }).catch(() => {
    throw unauthorized('OIDC access token is invalid.')
  })
  if (!payload.sub) throw unauthorized('OIDC access token has no subject.')
  const grantedScopes = scopes(payload)
  requireScope(grantedScopes, requiredScope)
  return {
    kind: 'human',
    issuer: payload.iss!,
    subject: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    scopes: grantedScopes,
  }
}

export async function authenticateAgent(request: Request, env: Env): Promise<AgentPrincipal> {
  const rawToken = bearer(request, 'DPoP')
  const jwks = await keySet(env)
  const { payload, protectedHeader } = await jwtVerify(rawToken, jwks, {
    issuer: env.OIDC_ISSUER,
    audience: env.OIDC_AUDIENCE,
    algorithms: ['RS256'],
  }).catch(() => {
    throw agentUnauthorized('Agent access token is invalid.')
  })
  if (protectedHeader.typ !== 'at+jwt') throw agentUnauthorized('Agent access token type is invalid.')

  const grantedScopes = scopes(payload)
  if (!grantedScopes.includes('wallet:x402:pay')) {
    throw agentUnauthorized('The wallet:x402:pay scope is required.')
  }
  const confirmation = payload.cnf as { jkt?: unknown } | undefined
  if (typeof confirmation?.jkt !== 'string') {
    throw agentUnauthorized('Agent access token is not DPoP-bound.')
  }

  await verifyDpopProof(request, rawToken, confirmation.jkt, payload.iss!, env.DB)

  const agent = resolveFlareAuthAgent(payload, env.OIDC_ISSUER)
  if (typeof payload.sub !== 'string') {
    throw agentUnauthorized('Agent access token has no authorizing user.')
  }

  return {
    kind: 'agent',
    owner: { issuer: env.OIDC_ISSUER, subject: payload.sub },
    agent,
    scopes: grantedScopes,
  }
}

const remoteKeySets = new Map<string, Promise<ReturnType<typeof createRemoteJWKSet>>>()

async function keySet(env: Env) {
  const inline = (env as Env & { OIDC_JWKS?: string }).OIDC_JWKS
  if (inline) return createLocalJWKSet(JSON.parse(inline))

  let pending = remoteKeySets.get(env.OIDC_ISSUER)
  if (!pending) {
    pending = discoverKeySet(env.OIDC_ISSUER)
    remoteKeySets.set(env.OIDC_ISSUER, pending)
    pending.catch(() => remoteKeySets.delete(env.OIDC_ISSUER))
  }
  return pending
}

async function discoverKeySet(issuer: string) {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw unauthorized('OIDC discovery failed.')
  const metadata = (await response.json()) as { issuer?: unknown; jwks_uri?: unknown }
  if (metadata.issuer !== issuer || typeof metadata.jwks_uri !== 'string') {
    throw unauthorized('OIDC discovery metadata is invalid.')
  }
  return createRemoteJWKSet(new URL(metadata.jwks_uri))
}

function resolveFlareAuthAgent(payload: JWTPayload, issuer: string) {
  const host = payload.act as
    | {
        iss?: unknown
        sub?: unknown
        actor_type?: unknown
        act?: unknown
      }
    | undefined
  const agent = host?.act as { iss?: unknown; sub?: unknown; actor_type?: unknown } | undefined
  if (
    host?.iss !== issuer ||
    typeof host.sub !== 'string' ||
    host.actor_type !== 'host' ||
    agent?.iss !== issuer ||
    agent.actor_type !== 'agent' ||
    typeof agent.sub !== 'string'
  ) {
    throw agentUnauthorized('A delegated FlareAuth Agent access token is required.')
  }
  return { issuer, subject: agent.sub }
}

async function verifyDpopProof(
  request: Request,
  accessToken: string,
  expectedThumbprint: string,
  issuer: string,
  db: D1Database,
) {
  const compact = request.headers.get('dpop')
  if (!compact) throw dpopUnauthorized('DPoP proof is required.')
  let header: ReturnType<typeof decodeProtectedHeader>
  try {
    header = decodeProtectedHeader(compact)
  } catch {
    throw dpopUnauthorized('DPoP proof is malformed.')
  }
  if (
    header.typ !== 'dpop+jwt' ||
    !header.jwk ||
    (header.alg !== 'ES256' && header.alg !== 'EdDSA') ||
    'd' in header.jwk
  ) {
    throw dpopUnauthorized('DPoP proof header is invalid.')
  }
  const keyThumbprint = await calculateJwkThumbprint(header.jwk)
  if (keyThumbprint !== expectedThumbprint) {
    throw dpopUnauthorized('DPoP key does not match the access token.')
  }
  const publicKey = await importJWK(header.jwk, header.alg)
  const { payload } = await jwtVerify(compact, publicKey, { algorithms: [header.alg] }).catch(() => {
    throw dpopUnauthorized('DPoP proof signature is invalid.')
  })
  const now = Math.floor(Date.now() / 1000)
  if (
    payload.htm !== request.method ||
    payload.htu !== request.url ||
    typeof payload.iat !== 'number' ||
    Math.abs(now - payload.iat) > 60 ||
    typeof payload.jti !== 'string'
  ) {
    throw dpopUnauthorized('DPoP proof claims do not match the request.')
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  const ath = base64url(new Uint8Array(digest))
  if (payload.ath !== ath) throw dpopUnauthorized('DPoP access token hash is invalid.')
  const expiresAt = new Date((now + 120) * 1000).toISOString()
  await db.prepare('DELETE FROM dpop_replay WHERE expires_at <= ?').bind(new Date().toISOString()).run()
  const inserted = await db
    .prepare('INSERT OR IGNORE INTO dpop_replay (issuer, jti, expires_at) VALUES (?, ?, ?)')
    .bind(issuer, payload.jti, expiresAt)
    .run()
  if (inserted.meta.changes !== 1) throw dpopUnauthorized('DPoP proof was already used.')
}

function agentUnauthorized(message: string) {
  return unauthorized(message, {
    'WWW-Authenticate': `DPoP error="invalid_token", error_description="${message}"`,
  })
}

function dpopUnauthorized(message: string) {
  return unauthorized(message, {
    'WWW-Authenticate': `DPoP error="invalid_dpop_proof", error_description="${message}"`,
  })
}

function base64url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function parseJson<T>(value: unknown, parser: { safeParse: (input: unknown) => { success: boolean; data?: T } }): T {
  const parsed = parser.safeParse(value)
  if (!parsed.success) throw badRequest('Request body is invalid.')
  return parsed.data!
}
