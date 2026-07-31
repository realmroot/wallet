export const sandboxApiPrefix = '/api/sandbox'
export const publicRequestUrlHeader = 'X-Agent-Wallet-Public-Url'

export type WalletEnvironment = 'production' | 'sandbox'
type DeploymentBindings = Omit<
  Env,
  'APP_BASE_URL' | 'OIDC_AUDIENCE' | 'DEFAULT_WALLET_NETWORK' | 'WALLET_ENVIRONMENT'
>

export function resolveWalletRequest(request: Request, env: DeploymentBindings) {
  const url = new URL(request.url)
  if (url.pathname !== sandboxApiPrefix && !url.pathname.startsWith(`${sandboxApiPrefix}/`)) {
    const resolvedRequest = new Request(request)
    resolvedRequest.headers.delete(publicRequestUrlHeader)
    return { request: resolvedRequest, env: productionBindings(env) }
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

export function sandboxBindings(env: DeploymentBindings): Env {
  const production = productionBindings(env)
  return {
    ...production,
    DB: production.SANDBOX_DB,
    APP_BASE_URL: `${production.APP_ORIGIN}/sandbox`,
    OIDC_AUDIENCE: `${production.APP_ORIGIN}/api/sandbox`,
    DEFAULT_WALLET_NETWORK: firstNetwork(production.SANDBOX_WALLET_NETWORKS),
    WALLET_NETWORKS: production.SANDBOX_WALLET_NETWORKS,
    PAYMENT_NETWORKS: production.SANDBOX_PAYMENT_NETWORKS,
    WALLET_ENVIRONMENT: 'sandbox',
  }
}

export function walletEnvironments(env: DeploymentBindings) {
  return [productionBindings(env), sandboxBindings(env)] as const
}

function productionBindings(env: DeploymentBindings): Env {
  return {
    ...env,
    APP_BASE_URL: env.APP_ORIGIN,
    OIDC_AUDIENCE: `${env.APP_ORIGIN}/api`,
    DEFAULT_WALLET_NETWORK: firstNetwork(env.WALLET_NETWORKS),
    WALLET_ENVIRONMENT: 'production',
  }
}

function firstNetwork(networks: string) {
  const network = networks.split(',', 1)[0]?.trim()
  if (!network) throw new Error('At least one Wallet network must be configured.')
  return network
}
