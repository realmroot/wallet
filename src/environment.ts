import type { PublicConfig } from './api-client'

export type WalletEnvironment = 'production' | 'sandbox'

export const walletEnvironment: WalletEnvironment =
  location.pathname === '/sandbox' || location.pathname.startsWith('/sandbox/')
    ? 'sandbox'
    : 'production'

export const appBasePath = walletEnvironment === 'sandbox' ? '/sandbox' : ''
export const apiBasePath = walletEnvironment === 'sandbox' ? '/api/sandbox' : '/api'
export const chainAlias = routeChainAlias(location.pathname, walletEnvironment)
export const routerBasePath = `${appBasePath}${chainAlias ? `/chains/${chainAlias}` : ''}`

export function selectedNetwork(config: PublicConfig) {
  if (chainAlias) {
    const selected = config.networks.find((network) => network.alias === chainAlias)
    if (selected) return selected
  }
  const fallback = config.networks.find((network) => network.id === config.defaultNetwork)
  if (!fallback) throw new Error('The default Wallet network is not enabled.')
  return fallback
}

export function networkPath(config: PublicConfig, networkId: string, page = '/') {
  const network = config.networks.find((candidate) => candidate.id === networkId)
  if (!network) throw new Error('The Wallet network is not enabled.')
  const chainPath = network.id === config.defaultNetwork ? '' : `/chains/${network.alias}`
  return `${appBasePath}${chainPath}${page === '/' ? '' : page}`
}

export function networkName(network: string) {
  const names: Record<string, string> = {
    'eip155:8453': 'Base',
    'eip155:84532': 'Base Sepolia',
    'eip155:137': 'Polygon',
    'eip155:42161': 'Arbitrum',
    'eip155:480': 'World Chain',
    'eip155:4801': 'World Sepolia',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'Solana',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'Solana Devnet',
  }
  return names[network] ?? network
}

export function blockExplorerAddressUrl(network: string, address: string) {
  const origin = blockExplorerOrigin(network)
  if (!origin) return null
  const suffix = network === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' ? '?cluster=devnet' : ''
  return `${origin}/address/${address}${suffix}`
}

export function blockExplorerTransactionUrl(network: string, transactionHash: string) {
  const origin = blockExplorerOrigin(network)
  if (!origin) return null
  const suffix = network === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' ? '?cluster=devnet' : ''
  return `${origin}/tx/${transactionHash}${suffix}`
}

function blockExplorerOrigin(network: string) {
  const origins: Record<string, string> = {
    'eip155:8453': 'https://basescan.org',
    'eip155:84532': 'https://sepolia.basescan.org',
    'eip155:137': 'https://polygonscan.com',
    'eip155:42161': 'https://arbiscan.io',
    'eip155:480': 'https://worldscan.org',
    'eip155:4801': 'https://sepolia.worldscan.org',
    'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': 'https://explorer.solana.com',
    'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1': 'https://explorer.solana.com',
  }
  return origins[network] ?? null
}

function routeChainAlias(pathname: string, environment: WalletEnvironment) {
  const prefix = environment === 'sandbox' ? '/sandbox/chains/' : '/chains/'
  if (!pathname.startsWith(prefix)) return null
  const alias = pathname.slice(prefix.length).split('/', 1)[0]
  return alias || null
}
