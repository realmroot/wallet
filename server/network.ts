import { arbitrum, base, baseSepolia, polygon, worldchain, worldchainSepolia } from 'viem/chains'
import type { WalletMode } from '../shared/contracts'

export const walletNetworkIds = [
  'eip155:8453',
  'eip155:84532',
  'eip155:137',
  'eip155:42161',
  'eip155:480',
  'eip155:4801',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
] as const

export type WalletNetwork = (typeof walletNetworkIds)[number]
export type AccountFamily = 'evm' | 'solana'
export type FaucetAsset = 'usdc' | 'native'

export interface WalletNetworkDefinition {
  id: WalletNetwork
  alias: string
  name: string
  mode: WalletMode
  family: AccountFamily
  asset: {
    symbol: 'USDC'
    address: string
    decimals: 6
  }
  nativeSymbol: string
  explorerOrigin: string
  rpcBinding: keyof Env
  faucetAssets: readonly FaucetAsset[]
}

const definitions: readonly WalletNetworkDefinition[] = [
  {
    id: 'eip155:8453',
    alias: 'base',
    name: 'Base',
    mode: 'production',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
    nativeSymbol: 'ETH',
    explorerOrigin: 'https://basescan.org',
    rpcBinding: 'BASE_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'eip155:84532',
    alias: 'base-sepolia',
    name: 'Base Sepolia',
    mode: 'sandbox',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
    nativeSymbol: 'ETH',
    explorerOrigin: 'https://sepolia.basescan.org',
    rpcBinding: 'BASE_SEPOLIA_RPC_URL',
    faucetAssets: ['usdc', 'native'],
  },
  {
    id: 'eip155:137',
    alias: 'polygon',
    name: 'Polygon',
    mode: 'production',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6 },
    nativeSymbol: 'POL',
    explorerOrigin: 'https://polygonscan.com',
    rpcBinding: 'POLYGON_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'eip155:42161',
    alias: 'arbitrum',
    name: 'Arbitrum',
    mode: 'production',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 },
    nativeSymbol: 'ETH',
    explorerOrigin: 'https://arbiscan.io',
    rpcBinding: 'ARBITRUM_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'eip155:480',
    alias: 'world',
    name: 'World Chain',
    mode: 'production',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', decimals: 6 },
    nativeSymbol: 'ETH',
    explorerOrigin: 'https://worldscan.org',
    rpcBinding: 'WORLD_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'eip155:4801',
    alias: 'world-sepolia',
    name: 'World Sepolia',
    mode: 'sandbox',
    family: 'evm',
    asset: { symbol: 'USDC', address: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88', decimals: 6 },
    nativeSymbol: 'ETH',
    explorerOrigin: 'https://sepolia.worldscan.org',
    rpcBinding: 'WORLD_SEPOLIA_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    alias: 'solana',
    name: 'Solana',
    mode: 'production',
    family: 'solana',
    asset: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
    nativeSymbol: 'SOL',
    explorerOrigin: 'https://explorer.solana.com',
    rpcBinding: 'SOLANA_RPC_URL',
    faucetAssets: [],
  },
  {
    id: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    alias: 'solana-devnet',
    name: 'Solana Devnet',
    mode: 'sandbox',
    family: 'solana',
    asset: { symbol: 'USDC', address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', decimals: 6 },
    nativeSymbol: 'SOL',
    explorerOrigin: 'https://explorer.solana.com',
    rpcBinding: 'SOLANA_DEVNET_RPC_URL',
    faucetAssets: ['usdc', 'native'],
  },
]

const byId = new Map(definitions.map((definition) => [definition.id, definition]))
const byAlias = new Map(definitions.map((definition) => [definition.alias, definition]))

export function walletNetwork(value: string): WalletNetwork {
  if (byId.has(value as WalletNetwork)) return value as WalletNetwork
  throw new Error(`Unsupported Wallet network: ${value}`)
}

export function walletNetworkDefinition(value: string) {
  const definition = byId.get(walletNetwork(value))
  if (!definition) throw new Error(`Unsupported Wallet network: ${value}`)
  return definition
}

export function walletNetworkByAlias(alias: string) {
  return byAlias.get(alias) ?? null
}

export function walletNetworks(env: Env) {
  const configured = configuredNetworkSet(env.WALLET_NETWORKS)
  return definitions.filter((definition) => configured.has(definition.id))
}

export function defaultWalletNetwork(env: Env) {
  const network = walletNetworkDefinition(env.DEFAULT_WALLET_NETWORK)
  if (!walletNetworks(env).some((candidate) => candidate.id === network.id)) {
    throw new Error(`Default Wallet network is not enabled: ${network.id}`)
  }
  return network
}

export function networkPaymentsEnabled(env: Env, network: string) {
  return configuredNetworkSet(env.PAYMENT_NETWORKS).has(walletNetwork(network))
}

export function walletNetworkRpcUrl(env: Env, network: string) {
  const definition = walletNetworkDefinition(network)
  const value = env[definition.rpcBinding]
  if (typeof value !== 'string' || !value) {
    throw new Error(`${String(definition.rpcBinding)} is required for ${definition.id}.`)
  }
  return value
}

export function walletChain(value: string) {
  switch (walletNetwork(value)) {
    case 'eip155:8453': return base
    case 'eip155:84532': return baseSepolia
    case 'eip155:137': return polygon
    case 'eip155:42161': return arbitrum
    case 'eip155:480': return worldchain
    case 'eip155:4801': return worldchainSepolia
    default: throw new Error(`Wallet network is not EVM: ${value}`)
  }
}

export function cdpEvmNetwork(value: string) {
  const definition = walletNetworkDefinition(value)
  if (definition.family !== 'evm') throw new Error(`Wallet network is not EVM: ${value}`)
  return definition.alias
}

export function cdpSolanaNetwork(value: string): 'solana' | 'solana-devnet' {
  const network = walletNetwork(value)
  if (network === 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp') return 'solana'
  if (network === 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1') return 'solana-devnet'
  throw new Error(`Wallet network is not Solana: ${value}`)
}

export function walletNetworkName(value: string) {
  return walletNetworkDefinition(value).name
}

export function blockExplorerAddressUrl(network: string, address: string) {
  const definition = walletNetworkDefinition(network)
  const suffix = definition.family === 'solana' && definition.alias === 'solana-devnet' ? '?cluster=devnet' : ''
  return `${definition.explorerOrigin}/address/${address}${suffix}`
}

export function blockExplorerTransactionUrl(network: string, transaction: string) {
  const definition = walletNetworkDefinition(network)
  const suffix = definition.family === 'solana' && definition.alias === 'solana-devnet' ? '?cluster=devnet' : ''
  return `${definition.explorerOrigin}/tx/${transaction}${suffix}`
}

function configuredNetworkSet(value: string) {
  return new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map(walletNetwork),
  )
}
