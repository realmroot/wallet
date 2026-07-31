import { readFile } from 'node:fs/promises'
import { parse } from 'smol-toml'

const config = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'))
const errors = []
const variables = config.vars ?? {}
const productionDatabase = config.d1_databases?.find((binding) => binding.binding === 'DB')
const sandboxDatabase = config.d1_databases?.find((binding) => binding.binding === 'SANDBOX_DB')

for (const name of [
  'APP_ORIGIN',
  'OIDC_ISSUER',
  'BASE_RPC_URL',
  'BASE_SEPOLIA_RPC_URL',
  'POLYGON_RPC_URL',
  'ARBITRUM_RPC_URL',
  'WORLD_RPC_URL',
  'WORLD_SEPOLIA_RPC_URL',
]) {
  const value = variables[name]
  let url
  try {
    url = new URL(value)
  } catch {
    errors.push(`${name} must be a valid production URL.`)
    continue
  }
  if (url.protocol !== 'https:') {
    errors.push(`${name} must be an HTTPS production URL.`)
  }
  if (url.username || url.password || url.search || url.hash) {
    errors.push(`${name} must not contain credentials, a query, or a fragment.`)
  }
}
if (variables.APP_ORIGIN && new URL(variables.APP_ORIGIN).origin !== variables.APP_ORIGIN) {
  errors.push('APP_ORIGIN must be an origin without a path or trailing slash.')
}
if (variables.OIDC_ISSUER?.endsWith('/')) {
  errors.push('OIDC_ISSUER must not have a trailing slash.')
}
if (variables.SIGNER_MODE !== 'cdp') {
  errors.push('SIGNER_MODE must be cdp.')
}
const productionNetworks = new Set(variables.WALLET_NETWORKS?.split(',') ?? [])
for (const network of [
  'eip155:8453',
  'eip155:137',
  'eip155:42161',
  'eip155:480',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
]) {
  if (!productionNetworks.has(network)) errors.push(`WALLET_NETWORKS must include ${network}.`)
}
if (variables.PAYMENT_NETWORKS !== '') {
  errors.push('Production PAYMENT_NETWORKS must remain empty until mainnet acceptance.')
}
if (variables.WALLET_NETWORKS?.split(',', 1)[0] !== 'eip155:8453') {
  errors.push('The first production Wallet network must be Base Mainnet (eip155:8453).')
}
if (variables.SANDBOX_WALLET_NETWORKS?.split(',', 1)[0] !== 'eip155:84532') {
  errors.push('The first Sandbox Wallet network must be Base Sepolia (eip155:84532).')
}
const sandboxNetworks = new Set(variables.SANDBOX_WALLET_NETWORKS?.split(',') ?? [])
const sandboxPaymentNetworks = new Set(variables.SANDBOX_PAYMENT_NETWORKS?.split(',') ?? [])
for (const network of [
  'eip155:84532',
  'eip155:4801',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
]) {
  if (!sandboxNetworks.has(network)) errors.push(`SANDBOX_WALLET_NETWORKS must include ${network}.`)
  if (!sandboxPaymentNetworks.has(network)) errors.push(`SANDBOX_PAYMENT_NETWORKS must include ${network}.`)
}
if (typeof variables.OIDC_CLIENT_ID !== 'string' || variables.OIDC_CLIENT_ID.trim() === '') {
  errors.push('OIDC_CLIENT_ID must be configured.')
}
if (typeof variables.CDP_PROJECT_ID !== 'string' || variables.CDP_PROJECT_ID.trim() === '') {
  errors.push('CDP_PROJECT_ID must be configured as a public Wrangler variable.')
}
if (typeof variables.CDP_API_KEY_ID !== 'string' || variables.CDP_API_KEY_ID.trim() === '') {
  errors.push('CDP_API_KEY_ID must be configured as a public Wrangler variable.')
}
for (const secret of [
  'CDP_API_KEY_SECRET',
  'CDP_WALLET_SECRET',
  'SOLANA_RPC_URL',
  'SOLANA_DEVNET_RPC_URL',
]) {
  if (secret in variables) errors.push(`${secret} must be stored as a Wrangler secret.`)
}
if (
  !productionDatabase?.database_id ||
  /^0+$/.test(productionDatabase.database_id.replaceAll('-', ''))
) {
  errors.push('The DB binding must use a real D1 database_id.')
}
if (!sandboxDatabase?.database_id || /^0+$/.test(sandboxDatabase.database_id.replaceAll('-', ''))) {
  errors.push('The SANDBOX_DB binding must use a real D1 database_id.')
}
if (productionDatabase?.database_id === sandboxDatabase?.database_id) {
  errors.push('Production and Sandbox must use different D1 databases.')
}
if (!config.triggers?.crons?.includes('*/2 * * * *')) {
  errors.push('The two-minute payment reconciliation schedule must be configured.')
}

if (errors.length > 0) {
  throw new Error(`Production configuration is incomplete:\n- ${errors.join('\n- ')}`)
}

process.stdout.write('Production Wrangler configuration is ready.\n')
