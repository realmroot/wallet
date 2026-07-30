export const sandboxApiPrefix = '/api/sandbox'
export const publicRequestUrlHeader = 'X-Agent-Wallet-Public-Url'

export type WalletEnvironment = 'production' | 'sandbox'

export function resolveWalletRequest(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.pathname !== sandboxApiPrefix && !url.pathname.startsWith(`${sandboxApiPrefix}/`)) {
    const resolvedRequest = new Request(request)
    resolvedRequest.headers.delete(publicRequestUrlHeader)
    return { request: resolvedRequest, env }
  }

  const publicUrl = new URL(url)
  publicUrl.search = ''
  publicUrl.hash = ''
  url.pathname = `/api${url.pathname.slice(sandboxApiPrefix.length)}`
  const resolvedRequest = new Request(url, request)
  resolvedRequest.headers.set(publicRequestUrlHeader, publicUrl.href)
  return {
    request: resolvedRequest,
    env: sandboxBindings(env),
  }
}

export function sandboxBindings(env: Env): Env {
  return {
    ...env,
    DB: env.SANDBOX_DB,
    APP_BASE_URL: `${env.APP_ORIGIN}/sandbox`,
    OIDC_AUDIENCE: env.SANDBOX_OIDC_AUDIENCE,
    WALLET_NETWORK: env.SANDBOX_WALLET_NETWORK,
    WALLET_RPC_URL: env.SANDBOX_WALLET_RPC_URL,
    PAYMENTS_ENABLED: env.SANDBOX_PAYMENTS_ENABLED,
    WALLET_ENVIRONMENT: 'sandbox',
  }
}

export function walletEnvironments(env: Env) {
  return [env, sandboxBindings(env)] as const
}
