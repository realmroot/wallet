export type WalletEnvironment = 'production' | 'sandbox'

export const walletEnvironment: WalletEnvironment =
  location.pathname === '/sandbox' || location.pathname.startsWith('/sandbox/')
    ? 'sandbox'
    : 'production'

export const appBasePath = walletEnvironment === 'sandbox' ? '/sandbox' : ''
export const apiBasePath = walletEnvironment === 'sandbox' ? '/api/sandbox' : '/api'

export function networkName(network: string) {
  if (network === 'eip155:8453') return 'Base Mainnet'
  if (network === 'eip155:84532') return 'Base Sepolia'
  return network
}

export function blockExplorerAddressUrl(network: string, address: string) {
  const origin =
    network === 'eip155:8453'
      ? 'https://basescan.org'
      : network === 'eip155:84532'
        ? 'https://sepolia.basescan.org'
        : null
  return origin ? `${origin}/address/${address}` : null
}
