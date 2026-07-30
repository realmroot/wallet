import { base, baseSepolia } from 'viem/chains'

export type WalletNetwork = 'eip155:8453' | 'eip155:84532'

export function walletNetwork(value: string): WalletNetwork {
  if (value === 'eip155:8453' || value === 'eip155:84532') return value
  throw new Error(`Unsupported Wallet network: ${value}`)
}

export function walletChain(value: string) {
  return walletNetwork(value) === 'eip155:8453' ? base : baseSepolia
}

export function cdpNetwork(value: string): 'base' | 'base-sepolia' {
  return walletNetwork(value) === 'eip155:8453' ? 'base' : 'base-sepolia'
}

export function walletNetworkName(value: string) {
  return walletNetwork(value) === 'eip155:8453' ? 'Base Mainnet' : 'Base Sepolia'
}
