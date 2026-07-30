export interface PublicConfig {
  appOrigin: string
  oidcIssuer: string
  clientId: string
  audience: string
  agentIssuer: string
  network: string
  cdpProjectId: string | null
}

interface OidcMetadata {
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
}

const prefix = 'agent-wallet.'
let callbackExchange: Promise<void> | null = null

export async function loadConfig(): Promise<PublicConfig> {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('Wallet configuration is unavailable.')
  return response.json()
}

export function accessToken() {
  return localStorage.getItem(`${prefix}access_token`)
}

export function hasToken() {
  return Boolean(accessToken())
}

export async function beginLogin(config: PublicConfig, returnTo = '/') {
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
    redirect_uri: `${config.appOrigin}/oidc/callback`,
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

  const metadata = await discovery(config.oidcIssuer)
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.clientId,
      redirect_uri: `${config.appOrigin}/oidc/callback`,
      code,
      code_verifier: verifier,
      resource: config.audience,
    }),
  })
  if (!response.ok) throw new Error('OIDC token exchange failed.')
  storeTokens((await response.json()) as TokenResponse)
  sessionStorage.removeItem(`${prefix}state`)
  sessionStorage.removeItem(`${prefix}nonce`)
  sessionStorage.removeItem(`${prefix}verifier`)
  const returnTo = sessionStorage.getItem(`${prefix}return_to`) ?? '/'
  sessionStorage.removeItem(`${prefix}return_to`)
  history.replaceState({}, '', returnTo)
}

export async function refreshAccessToken(config: PublicConfig) {
  const refreshToken = localStorage.getItem(`${prefix}refresh_token`)
  if (!refreshToken) throw new Error('OIDC login expired.')
  const metadata = await discovery(config.oidcIssuer)
  const response = await fetch(metadata.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.clientId,
      refresh_token: refreshToken,
      resource: config.audience,
    }),
  })
  if (!response.ok) {
    clearTokens()
    throw new Error('OIDC refresh token was rejected.')
  }
  storeTokens((await response.json()) as TokenResponse)
}

export async function logout(config: PublicConfig) {
  const refreshToken = localStorage.getItem(`${prefix}refresh_token`)
  if (refreshToken) {
    const metadata = await discovery(config.oidcIssuer)
    if (metadata.revocation_endpoint) {
      await fetch(metadata.revocation_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: refreshToken,
          token_type_hint: 'refresh_token',
          client_id: config.clientId,
        }),
      })
    }
  }
  clearTokens()
}

export async function api<T>(config: PublicConfig, path: string, init?: RequestInit): Promise<T> {
  const call = () =>
    fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
        authorization: `Bearer ${accessToken()}`,
      },
    })
  let response = await call()
  if (response.status === 401 && localStorage.getItem(`${prefix}refresh_token`)) {
    await refreshAccessToken(config)
    response = await call()
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null
    throw new Error(body?.message ?? `Request failed with ${response.status}.`)
  }
  if (response.status === 204) return undefined as T
  return response.json()
}

function storeTokens(tokens: TokenResponse) {
  localStorage.setItem(`${prefix}access_token`, tokens.access_token)
  if (tokens.refresh_token) localStorage.setItem(`${prefix}refresh_token`, tokens.refresh_token)
  if (tokens.id_token) localStorage.setItem(`${prefix}id_token`, tokens.id_token)
  localStorage.setItem(`${prefix}expires_at`, String(Date.now() + tokens.expires_in * 1000))
}

function clearTokens() {
  for (const key of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    localStorage.removeItem(`${prefix}${key}`)
  }
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
