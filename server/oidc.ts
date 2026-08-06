import { forbidden, upstreamError } from './errors'
import { z } from 'zod'

const authorizationCodeInput = z.object({
  grantType: z.literal('authorization_code'),
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
})

const refreshTokenInput = z.object({
  grantType: z.literal('refresh_token'),
  refreshToken: z.string().min(1),
})

export const oidcTokenInput = z.discriminatedUnion('grantType', [
  authorizationCodeInput,
  refreshTokenInput,
])

export const oidcRevokeInput = z.object({
  token: z.string().min(1),
})

const oidcMetadata = z.object({
  token_endpoint: z.url(),
  revocation_endpoint: z.url().optional(),
})

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
})

export type OidcTokenInput = z.infer<typeof oidcTokenInput>

export function requireWalletOrigin(request: Request, appOrigin: string) {
  if (request.headers.get('origin') !== appOrigin) {
    throw forbidden('OIDC browser requests must come from the Wallet origin.')
  }
}

export async function exchangeOidcToken(env: Env, input: OidcTokenInput) {
  const metadata = await discoverOidc(env.OIDC_ISSUER)
  const body =
    input.grantType === 'authorization_code'
      ? new URLSearchParams({
          grant_type: input.grantType,
          client_id: env.OIDC_CLIENT_ID,
          redirect_uri: `${env.APP_BASE_URL}/oidc/callback`,
          code: input.code,
          code_verifier: input.codeVerifier,
          resource: env.OIDC_AUDIENCE,
        })
      : new URLSearchParams({
          grant_type: input.grantType,
          client_id: env.OIDC_CLIENT_ID,
          refresh_token: input.refreshToken,
          resource: env.OIDC_AUDIENCE,
        })

  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw upstreamError(
      'OIDC token exchange failed.',
      await oidcFailureDiagnostics(response, 'token_exchange'),
    )
  }

  const result = tokenResponse.safeParse(await response.json().catch(() => null))
  if (!result.success) {
    throw upstreamError('OIDC token response is invalid.', {
      dependency: 'oidc',
      operation: 'token_exchange',
      upstreamStatus: response.status,
      schemaIssues: result.error.issues.map(({ code, path }) => ({ code, path })),
    })
  }
  return result.data
}

export async function revokeOidcToken(env: Env, token: string) {
  const metadata = await discoverOidc(env.OIDC_ISSUER)
  if (!metadata.revocation_endpoint) return

  const response = await fetch(metadata.revocation_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      token_type_hint: 'refresh_token',
      client_id: env.OIDC_CLIENT_ID,
    }),
  })
  if (!response.ok) {
    throw upstreamError(
      'OIDC token revocation failed.',
      await oidcFailureDiagnostics(response, 'token_revocation'),
    )
  }
}

async function discoverOidc(issuer: string) {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!response.ok) {
    throw upstreamError(
      'OIDC discovery failed.',
      await oidcFailureDiagnostics(response, 'discovery'),
    )
  }

  const result = oidcMetadata.safeParse(await response.json().catch(() => null))
  if (!result.success) {
    throw upstreamError('OIDC discovery metadata is invalid.', {
      dependency: 'oidc',
      operation: 'discovery',
      upstreamStatus: response.status,
      schemaIssues: result.error.issues.map(({ code, path }) => ({ code, path })),
    })
  }
  return result.data
}

async function oidcFailureDiagnostics(response: Response, operation: string) {
  const payload = await response.json<unknown>().catch(() => null)
  const fields =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : undefined
  return {
    dependency: 'oidc',
    operation,
    upstreamStatus: response.status,
    upstreamStatusText: response.statusText,
    upstreamCode: firstString(fields, ['error', 'code', 'errorType']),
    upstreamMessage: firstString(fields, ['error_description', 'message', 'errorMessage']),
  }
}

function firstString(fields: Record<string, unknown> | undefined, names: string[]) {
  for (const name of names) {
    const value = fields?.[name]
    if (typeof value === 'string') return value.slice(0, 1_000)
  }
  return undefined
}
