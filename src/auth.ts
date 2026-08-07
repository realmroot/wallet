import { type PublicConfig, walletApi } from './api-client'
import { routerBasePath } from './environment'
import * as oauth from 'oauth4webapi'

export type { PublicConfig } from './api-client'

export interface IdentityProfile {
  subject: string
  name: string | null
  email: string | null
  picture: string | null
}

const prefix = 'agent-wallet.'
const legacySandboxPrefix = 'agent-wallet.sandbox.'
const sharedRefreshTokenKey = 'agent-wallet.session.refresh_token'
const identityKey = `${prefix}identity`
const authorizationServers = new Map<string, Promise<oauth.AuthorizationServer>>()
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

export function identityProfile(): IdentityProfile | null {
  const value = localStorage.getItem(identityKey)
  if (!value) return null
  const profile = JSON.parse(value) as Partial<IdentityProfile>
  if (
    typeof profile.subject !== 'string' ||
    !nullableString(profile.name) ||
    !nullableString(profile.email) ||
    !nullableString(profile.picture)
  ) {
    throw new Error('Stored OIDC identity is invalid.')
  }
  return profile as IdentityProfile
}

export async function cdpAccessToken(config: PublicConfig) {
  const audience = `${config.appOrigin}/api`
  const cached = currentAccessToken(prefix, audience)
  if (cached) return cached
  await refreshAccessToken(config)
  const refreshed = accessToken()
  if (!refreshed || !tokenHasAudience(refreshed, audience)) {
    throw new Error('OIDC token exchange returned an invalid CDP audience.')
  }
  return refreshed
}

export function hasToken() {
  return Boolean(accessToken() && identityProfile())
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
  const server = await authorizationServer(config)
  if (!server.authorization_endpoint) throw new Error('OIDC authorization endpoint is unavailable.')
  const state = oauth.generateRandomState()
  const nonce = oauth.generateRandomNonce()
  const verifier = oauth.generateRandomCodeVerifier()
  const challenge = await oauth.calculatePKCECodeChallenge(verifier)
  sessionStorage.setItem(`${prefix}state`, state)
  sessionStorage.setItem(`${prefix}nonce`, nonce)
  sessionStorage.setItem(`${prefix}verifier`, verifier)
  sessionStorage.setItem(`${prefix}return_to`, returnTo)

  const url = new URL(server.authorization_endpoint)
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
  const expectedState = sessionStorage.getItem(`${prefix}state`)
  const expectedNonce = sessionStorage.getItem(`${prefix}nonce`)
  const verifier = sessionStorage.getItem(`${prefix}verifier`)
  if (!expectedState || !expectedNonce || !verifier) throw new Error('OIDC callback is invalid.')

  const server = await authorizationServer(config)
  const client = oidcClient(config)
  const callbackParameters = oauth.validateAuthResponse(
    server,
    client,
    new URL(location.href),
    expectedState,
  )
  const response = await oauth.authorizationCodeGrantRequest(
    server,
    client,
    oauth.None(),
    callbackParameters,
    `${config.appOrigin}/oidc/callback`,
    verifier,
    {
      additionalParameters: { resource: config.audience },
      [oauth.allowInsecureRequests]: allowInsecure(config),
    },
  )
  const tokens = await oauth.processAuthorizationCodeResponse(server, client, response, {
    expectedNonce,
    requireIdToken: true,
  })
  storeTokens(tokens)
  sessionStorage.removeItem(`${prefix}state`)
  sessionStorage.removeItem(`${prefix}nonce`)
  sessionStorage.removeItem(`${prefix}verifier`)
  const storedReturnTo = sessionStorage.getItem(`${prefix}return_to`)
  sessionStorage.removeItem(`${prefix}return_to`)
  return storedReturnTo?.startsWith('/') && !storedReturnTo.startsWith('//') ? storedReturnTo : '/'
}

export async function refreshAccessToken(config: PublicConfig) {
  const refreshToken = refreshTokens()[0]
  if (!refreshToken) throw new Error('OIDC refresh token is unavailable.')
  try {
    const server = await authorizationServer(config)
    const client = oidcClient(config)
    const response = await oauth.refreshTokenGrantRequest(
      server,
      client,
      oauth.None(),
      refreshToken,
      {
        additionalParameters: { resource: config.audience },
        [oauth.allowInsecureRequests]: allowInsecure(config),
      },
    )
    const tokens = await oauth.processRefreshTokenResponse(server, client, response)
    storeTokens(tokens)
  } catch (error) {
    clearTokens()
    localStorage.removeItem(sharedRefreshTokenKey)
    throw error
  }
}

export async function logout(config: PublicConfig) {
  try {
    const server = await authorizationServer(config)
    if (server.revocation_endpoint) {
      await Promise.all(refreshTokens().map(async (token) => {
        const response = await oauth.revocationRequest(
          server,
          oidcClient(config),
          oauth.None(),
          token,
          {
            additionalParameters: { token_type_hint: 'refresh_token' },
            [oauth.allowInsecureRequests]: allowInsecure(config),
          },
        )
        await oauth.processRevocationResponse(response)
      }))
    }
  } finally {
    clearTokens()
    clearLegacySandboxTokens()
    localStorage.removeItem(sharedRefreshTokenKey)
  }
}

function storeTokens(tokens: oauth.TokenEndpointResponse) {
  if (typeof tokens.expires_in !== 'number') throw new Error('OIDC token response has no expiration.')
  localStorage.setItem(`${prefix}access_token`, tokens.access_token)
  if (tokens.refresh_token) {
    localStorage.setItem(sharedRefreshTokenKey, tokens.refresh_token)
    localStorage.removeItem(`${prefix}refresh_token`)
  }
  if (tokens.id_token) localStorage.setItem(`${prefix}id_token`, tokens.id_token)
  const claims = oauth.getValidatedIdTokenClaims(tokens)
  if (claims) {
    const profile: IdentityProfile = {
      subject: claims.sub,
      name: stringClaim(claims.name),
      email: stringClaim(claims.email),
      picture: urlClaim(claims.picture),
    }
    localStorage.setItem(identityKey, JSON.stringify(profile))
  }
  localStorage.setItem(`${prefix}expires_at`, String(Date.now() + tokens.expires_in * 1000))
}

function clearTokens() {
  for (const key of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    localStorage.removeItem(`${prefix}${key}`)
  }
  localStorage.removeItem(identityKey)
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

function authorizationServer(config: Pick<PublicConfig, 'oidcIssuer'>) {
  let pending = authorizationServers.get(config.oidcIssuer)
  if (!pending) {
    const issuer = new URL(config.oidcIssuer)
    pending = oauth
      .discoveryRequest(issuer, { [oauth.allowInsecureRequests]: issuer.protocol === 'http:' })
      .then((response) => oauth.processDiscoveryResponse(issuer, response))
    authorizationServers.set(config.oidcIssuer, pending)
    pending.catch(() => authorizationServers.delete(config.oidcIssuer))
  }
  return pending
}

function oidcClient(config: Pick<PublicConfig, 'clientId'>): oauth.Client {
  return { client_id: config.clientId, token_endpoint_auth_method: 'none' }
}

function allowInsecure(config: Pick<PublicConfig, 'oidcIssuer'>) {
  return new URL(config.oidcIssuer).protocol === 'http:'
}

function stringClaim(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

function urlClaim(value: unknown) {
  const claim = stringClaim(value)
  if (!claim || !URL.canParse(claim)) return null
  const url = new URL(claim)
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
}

function nullableString(value: unknown) {
  return value === null || typeof value === 'string'
}
