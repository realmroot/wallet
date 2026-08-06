export function walletBindings(env: Cloudflare.Env): Env {
  return {
    ...env,
    APP_BASE_URL: env.APP_ORIGIN,
    OIDC_AUDIENCE: `${env.APP_ORIGIN}/api`,
    DEFAULT_WALLET_NETWORK: firstNetwork(env.WALLET_NETWORKS),
  }
}

function firstNetwork(networks: string) {
  const network = networks.split(',', 1)[0]?.trim()
  if (!network) throw new Error('At least one Wallet network must be configured.')
  return network
}
