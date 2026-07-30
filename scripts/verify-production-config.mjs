import { readFile } from 'node:fs/promises'

const config = JSON.parse(
  await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
)
const errors = []
const variables = config.vars ?? {}
const productionDatabase = config.d1_databases?.find((binding) => binding.binding === 'DB')
const sandboxDatabase = config.d1_databases?.find((binding) => binding.binding === 'SANDBOX_DB')

for (const name of [
  'APP_ORIGIN',
  'APP_BASE_URL',
  'OIDC_ISSUER',
  'OIDC_AUDIENCE',
  'WALLET_RPC_URL',
  'SANDBOX_OIDC_AUDIENCE',
  'SANDBOX_WALLET_RPC_URL',
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
if (variables.APP_BASE_URL !== variables.APP_ORIGIN) {
  errors.push('APP_BASE_URL must use the default production origin.')
}
if (variables.OIDC_ISSUER?.endsWith('/')) {
  errors.push('OIDC_ISSUER must not have a trailing slash.')
}
if (variables.SIGNER_MODE !== 'cdp') {
  errors.push('SIGNER_MODE must be cdp.')
}
if (variables.WALLET_NETWORK !== 'eip155:8453') {
  errors.push('WALLET_NETWORK must be Base Mainnet (eip155:8453).')
}
if (variables.SANDBOX_WALLET_NETWORK !== 'eip155:84532') {
  errors.push('SANDBOX_WALLET_NETWORK must be Base Sepolia (eip155:84532).')
}
if (variables.WALLET_ENVIRONMENT !== 'production') {
  errors.push('WALLET_ENVIRONMENT must be production for the default API.')
}
if (variables.PAYMENTS_ENABLED !== 'false') {
  errors.push('Production payments must remain disabled until mainnet acceptance.')
}
if (variables.SANDBOX_PAYMENTS_ENABLED !== 'true') {
  errors.push('Sandbox payments must be enabled.')
}
if (variables.OIDC_AUDIENCE !== `${variables.APP_ORIGIN}/api`) {
  errors.push('OIDC_AUDIENCE must use the default production API URL.')
}
if (variables.SANDBOX_OIDC_AUDIENCE !== `${variables.APP_ORIGIN}/api/sandbox`) {
  errors.push('SANDBOX_OIDC_AUDIENCE must use the sandbox API URL.')
}
if (typeof variables.OIDC_CLIENT_ID !== 'string' || variables.OIDC_CLIENT_ID.trim() === '') {
  errors.push('OIDC_CLIENT_ID must be configured.')
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
