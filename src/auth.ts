import { type PublicConfig, walletApi } from './api-client'
import { routerBasePath } from './environment'

export type { PublicConfig } from './api-client'

interface OidcMetadata {
  authorization_endpoint: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
}

const prefix = 'agent-wallet.'
const legacySandboxPrefix = 'agent-wallet.sandbox.'
const sharedRefreshTokenKey = 'agent-wallet.session.refresh_token'
let callbackExchange: Promise<string> | null = null
let loginRedirect: Promise<void> | null = null

export async function loadConfig(): Promise<PublicConfig> {
  clearLegacySandboxTokens()
  const response = await walletApi.config.$get()
  if (!response.ok) throw new Error('Wallet configuration is unavailable.')
  return response.json()
}

export function accessToken() {
  return localStorage.getItem(`${prefix}access_token`)
}

export async function cdpAccessToken(config: PublicConfig) {
  const audience = `${config.appOrigin}/api`
  const cached = currentAccessToken(prefix, audience)
  if (cached) return cached

  for (const refreshToken of refreshTokens()) {
    const response = await fetch(`${config.appOrigin}/api/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantType: 'refresh_token', refreshToken }),
    })
    if (!response.ok) continue
    const tokens = (await response.json()) as TokenResponse
    if (!tokenHasAudience(tokens.access_token, audience)) {
      throw new Error('OIDC token exchange returned an invalid CDP audience.')
    }
    storeTokens(tokens)
    return tokens.access_token
  }

  throw new Error('CDP authentication requires a Wallet session.')
}

export function hasToken() {
  return Boolean(accessToken())
}

export function hasRefreshToken() {
  return refreshTokens().length > 0
}

export function beginLogin(config: PublicConfig, returnTo = '/') {
  const routedReturnTo = `${routerBasePath}${returnTo === '/' ? '' : returnTo}` || '/'
  loginRedirect ??= startLogin(
    { ...config, appBaseUrl: config.appOrigin },
    routedReturnTo,
  ).catch((error: unknown) => {
    loginRedirect = null
    throw error
  })
  return loginRedirect
}

async function startLogin(
  config: Pick<PublicConfig, 'oidcIssuer' | 'clientId' | 'appBaseUrl' | 'audience'>,
  returnTo: string,
) {
  const metadata = await discovery(config.oidcIssuer)
  const state = crypto.randomUUID()
  const nonce = crypto.randomUUID()
  const verifier = randomBase64url(64)
  const challenge = await sha256Base64url(verifier)
  sessionStorage.setItem(`${prefix}state`, state)
  sessionStorage.setItem(`${prefix}nonce`, nonce)
  sessionStorage.setItem(`${prefix}verifier`, verifier)
  sessionStorage.setItem(`${prefix}return_to`, returnTo)

  const url = new URL(metadata.authorization_endpoint)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: `${config.appBaseUrl}/oidc/callback`,
    response_type: 'code',
    scope: 'openid profile email offline_access wallet:read wallet:manage',
    resource: config.audience,
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  location.assign(url)
}

export async function completeLogin(config: PublicConfig) {
  callbackExchange ??= exchangeAuthorizationCode(config)
  return callbackExchange
}

async function exchangeAuthorizationCode(config: PublicConfig) {
  const params = new URLSearchParams(location.search)
  const error = params.get('error')
  if (error) throw new Error(params.get('error_description') ?? error)
  const code = params.get('code')
  const state = params.get('state')
  const expectedState = sessionStorage.getItem(`${prefix}state`)
  const verifier = sessionStorage.getItem(`${prefix}verifier`)
  if (!code || !state || state !== expectedState || !verifier) throw new Error('OIDC callback is invalid.')

  const response = await walletApi.oidc.token.$post({
    json: {
      grantType: 'authorization_code',
      code,
      codeVerifier: verifier,
    },
  })
  if (!response.ok) throw new Error('OIDC token exchange failed.')
  storeTokens((await response.json()) as TokenResponse)
  sessionStorage.removeItem(`${prefix}state`)
  sessionStorage.removeItem(`${prefix}nonce`)
  sessionStorage.removeItem(`${prefix}verifier`)
  const storedReturnTo = sessionStorage.getItem(`${prefix}return_to`)
  sessionStorage.removeItem(`${prefix}return_to`)
  return storedReturnTo?.startsWith('/') && !storedReturnTo.startsWith('//') ? storedReturnTo : '/'
}

export async function refreshAccessToken(_config: PublicConfig) {
  for (const refreshToken of refreshTokens()) {
    const response = await walletApi.oidc.token.$post({
      json: {
        grantType: 'refresh_token',
        refreshToken,
      },
    })
    if (!response.ok) continue
    storeTokens((await response.json()) as TokenResponse)
    return
  }
  clearTokens()
  localStorage.removeItem(sharedRefreshTokenKey)
  throw new Error('OIDC refresh token was rejected.')
}

export async function logout(_config: PublicConfig) {
  try {
    await Promise.all(
      refreshTokens().map(async (token) => {
        const response = await walletApi.oidc.revoke.$post({ json: { token } })
        if (!response.ok) throw new Error('OIDC token revocation failed.')
      }),
    )
  } finally {
    clearTokens()
    clearLegacySandboxTokens()
    localStorage.removeItem(sharedRefreshTokenKey)
  }
}

function storeTokens(tokens: TokenResponse) {
  localStorage.setItem(`${prefix}access_token`, tokens.access_token)
  if (tokens.refresh_token) {
    localStorage.setItem(sharedRefreshTokenKey, tokens.refresh_token)
    localStorage.removeItem(`${prefix}refresh_token`)
  }
  if (tokens.id_token) localStorage.setItem(`${prefix}id_token`, tokens.id_token)
  localStorage.setItem(`${prefix}expires_at`, String(Date.now() + tokens.expires_in * 1000))
}

function clearTokens() {
  for (const key of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    localStorage.removeItem(`${prefix}${key}`)
  }
}

function clearLegacySandboxTokens() {
  for (const key of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    localStorage.removeItem(`${legacySandboxPrefix}${key}`)
  }
}

function currentAccessToken(storagePrefix: string, audience: string) {
  const token = localStorage.getItem(`${storagePrefix}access_token`)
  const expiresAt = Number(localStorage.getItem(`${storagePrefix}expires_at`))
  return token && expiresAt > Date.now() + 30_000 && tokenHasAudience(token, audience) ? token : null
}

function tokenHasAudience(token: string, expected: string) {
  try {
    const segment = token.split('.')[1]
    if (!segment) return false
    const encoded = segment.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))) as {
      aud?: string | string[]
    }
    return payload.aud === expected || payload.aud?.includes(expected) === true
  } catch {
    return false
  }
}

function refreshTokens() {
  return [
    localStorage.getItem(sharedRefreshTokenKey),
    localStorage.getItem(`${prefix}refresh_token`),
  ].filter((token, index, values): token is string =>
    Boolean(token) && values.indexOf(token) === index,
  )
}

async function discovery(issuer: string): Promise<OidcMetadata> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!response.ok) throw new Error('OIDC discovery failed.')
  return response.json()
}

function randomBase64url(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return base64url(bytes)
}

async function sha256Base64url(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64url(new Uint8Array(digest))
}

function base64url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
