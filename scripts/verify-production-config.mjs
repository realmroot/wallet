import { readFile } from 'node:fs/promises'
import { parse } from 'smol-toml'

const config = parse(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'))
const errors = []
const variables = config.vars ?? {}
const productionDatabase = config.d1_databases?.find((binding) => binding.binding === 'DB')

if (config.name !== 'agent-wallet') {
  errors.push('The production Worker name must be agent-wallet.')
}
if (productionDatabase?.database_name !== config.name) {
  errors.push('The production D1 database name must match the Worker name.')
}

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
const walletNetworks = new Set(variables.WALLET_NETWORKS?.split(',') ?? [])
for (const network of [
  'eip155:8453',
  'eip155:84532',
  'eip155:137',
  'eip155:42161',
  'eip155:480',
  'eip155:4801',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
]) {
  if (!walletNetworks.has(network)) errors.push(`WALLET_NETWORKS must include ${network}.`)
}
if (variables.WALLET_NETWORKS?.split(',', 1)[0] !== 'eip155:8453') {
  errors.push('The first production Wallet network must be Base Mainnet (eip155:8453).')
}
const paymentNetworks = new Set(variables.PAYMENT_NETWORKS?.split(',') ?? [])
for (const network of [
  'eip155:84532',
  'eip155:4801',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
]) {
  if (!paymentNetworks.has(network)) errors.push(`PAYMENT_NETWORKS must include ${network}.`)
}
for (const network of [
  'eip155:8453',
  'eip155:137',
  'eip155:42161',
  'eip155:480',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
]) {
  if (paymentNetworks.has(network)) {
    errors.push(`PAYMENT_NETWORKS must not enable mainnet ${network} before acceptance.`)
  }
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
if (!config.triggers?.crons?.includes('*/5 * * * *')) {
  errors.push('The five-minute expired-authorization reconciliation schedule must be configured.')
}

if (errors.length > 0) {
  throw new Error(`Production configuration is incomplete:\n- ${errors.join('\n- ')}`)
}

process.stdout.write('Production Wrangler configuration is ready.\n')
