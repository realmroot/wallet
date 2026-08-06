import { walletScopeCatalog } from './agent-policy'

export const protectedResourceMetadataPath =
  '/.well-known/oauth-protected-resource/api'

export function protectedResourceMetadata(env: Env) {
  return {
    resource: env.OIDC_AUDIENCE,
    authorization_servers: [env.OIDC_ISSUER],
    scopes_supported: Object.keys(walletScopeCatalog),
    bearer_methods_supported: ['header'],
    resource_name: 'Agent Wallet API',
    dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
  }
}

export function protectedResourceMetadataUrl(env: Env) {
  const resource = new URL(env.OIDC_AUDIENCE)
  const resourcePath = resource.pathname === '/' ? '' : resource.pathname
  const metadata = new URL(
    `/.well-known/oauth-protected-resource${resourcePath}`,
    resource.origin,
  )
  metadata.search = resource.search
  return metadata.href
}

export function withProtectedResourceMetadataChallenge(
  env: Env,
  challenge?: string | null,
) {
  if (challenge?.match(/(?:^|[,\s])resource_metadata\s*=/i)) return challenge
  const parameter = `resource_metadata="${protectedResourceMetadataUrl(env)}"`
  return challenge ? `${challenge}, ${parameter}` : `Bearer ${parameter}`
}
