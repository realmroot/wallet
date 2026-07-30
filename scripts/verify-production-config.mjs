import { readFile } from 'node:fs/promises'

const config = JSON.parse(
  await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
)
const errors = []
const variables = config.vars ?? {}
const database = config.d1_databases?.find((binding) => binding.binding === 'DB')

for (const name of ['APP_ORIGIN', 'OIDC_ISSUER', 'OIDC_AUDIENCE', 'WALLET_RPC_URL']) {
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
if (variables.WALLET_NETWORK !== 'eip155:84532') {
  errors.push('WALLET_NETWORK must be eip155:84532 for the current release.')
}
if (typeof variables.OIDC_CLIENT_ID !== 'string' || variables.OIDC_CLIENT_ID.trim() === '') {
  errors.push('OIDC_CLIENT_ID must be configured.')
}
if (!database?.database_id || /^0+$/.test(database.database_id.replaceAll('-', ''))) {
  errors.push('The DB binding must use a real D1 database_id.')
}
if (!config.triggers?.crons?.includes('*/2 * * * *')) {
  errors.push('The two-minute payment reconciliation schedule must be configured.')
}

if (errors.length > 0) {
  throw new Error(`Production configuration is incomplete:\n- ${errors.join('\n- ')}`)
}

process.stdout.write('Production Wrangler configuration is ready.\n')
