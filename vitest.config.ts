import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { configDefaults, defineConfig } from 'vitest/config'

const mockSignerPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const oidcJwks =
  '{"keys":[{"kty":"EC","x":"MILFoz663spK7Wqv4RYXxwuzKL8cjKMulu_uC09AF2Q","y":"e95GZitNto3GcOKOUE7mi5n6w6y9CEVy6opDBb3ew5k","crv":"P-256","kid":"human"},{"kty":"RSA","n":"lysCaEKG49Bz3GllXo_qpNTzs5RrZmDwxN9jgkLijtRaP0HGCcc80QY4zRAlgmVuq74cXYh4cEk7oyENx725fDbDt4b7ZqFhv6atkO1m2pf33tweXr2OhKIOVpf88vAQjSHVSOm9v-rI8SlJQrSvHIBQVta-IWtMy3kbOy_Ws_W2y7NpsryckQg-fRj2laKu128FNP2-xP1-4f6Bw0DFVAlMGRF2UG8hCOgJ0lNuCfaukunxRy-APcIWuYhZDM7Z6XPE-mGGNtosUfuQBLTkk0g7OoGodhNRO0hCcKaZlliCZlRlZcPYTS0pSwFeFuZoyVjo75UtCC-kRRnaXzT7fQ","e":"AQAB","kid":"agent"}]}'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          APP_ORIGIN: 'https://wallet.test',
          APP_BASE_URL: 'https://wallet.test',
          OIDC_ISSUER: 'https://fa.test/api/auth',
          OIDC_CLIENT_ID: 'agent-wallet-web',
          OIDC_AUDIENCE: 'https://wallet.test/api',
          WALLET_NETWORK: 'eip155:84532',
          PAYMENTS_ENABLED: 'true',
          WALLET_ENVIRONMENT: 'production',
          SANDBOX_OIDC_AUDIENCE: 'https://wallet.test/api/sandbox',
          SANDBOX_WALLET_NETWORK: 'eip155:84532',
          SANDBOX_WALLET_RPC_URL: 'https://sepolia.base.org',
          SANDBOX_PAYMENTS_ENABLED: 'true',
          SIGNER_MODE: 'mock',
          MOCK_SIGNER_PRIVATE_KEY: mockSignerPrivateKey,
          OIDC_JWKS: oidcJwks,
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
        outboundService: async (request) => {
          const url = new URL(request.url)
          if (url.origin === 'https://cdp.test') {
            const projectId = '11111111-1111-4111-8111-111111111111'
            const signingPath =
              '/platform/v2/embedded-wallet-api/end-users/custom-auth-user/evm/sign/typed-data'
            const delegationMatch = url.pathname.match(
              /^\/platform\/v2\/embedded-wallet-api\/end-users\/([^/]+)\/delegation$/,
            )
            if (delegationMatch && request.method === 'GET') {
              if (url.searchParams.get('projectID') !== projectId) {
                return cdpTestError(400, 'invalid_request', 'projectID is required.')
              }
              if (delegationMatch[1] === 'revoked-user') {
                return cdpTestError(403, 'delegation_not_found', 'Delegation is inactive.')
              }
              if (delegationMatch[1] === 'unavailable-user') {
                return cdpTestError(503, 'service_unavailable', 'CDP is unavailable.')
              }
              return Response.json({ expiresAt: '2099-01-01T00:00:00.000Z' })
            }
            if (url.pathname === signingPath && request.method === 'POST') {
              if (url.searchParams.get('projectID') !== projectId) {
                return cdpTestError(400, 'invalid_request', 'projectID is required.')
              }
              if (request.headers.get('X-Idempotency-Key') !== 'payment-request-12345678') {
                return cdpTestError(400, 'invalid_request', 'X-Idempotency-Key is required.')
              }
              const body = await request.json<{
                address?: string
                typedData?: { primaryType?: string }
              }>()
              if (
                body.address !== '0x1111111111111111111111111111111111111111' ||
                body.typedData?.primaryType !== 'Payment'
              ) {
                return cdpTestError(400, 'invalid_request', 'Unexpected signing payload.')
              }
              return Response.json({ signature: `0x${'ab'.repeat(65)}` })
            }
            return cdpTestError(404, 'not_found', 'Unexpected CDP test request.')
          }
          if (url.origin !== 'https://fa.test') {
            return new Response('Unexpected outbound request.', { status: 502 })
          }
          if (url.pathname === '/api/auth/.well-known/openid-configuration') {
            return Response.json({
              token_endpoint: 'https://fa.test/api/auth/oauth2/token',
              revocation_endpoint: 'https://fa.test/api/auth/oauth2/revoke',
            })
          }
          if (url.pathname === '/api/auth/oauth2/token' && request.method === 'POST') {
            return Response.json({
              access_token: 'access-token',
              refresh_token: 'refresh-token',
              id_token: 'id-token',
              expires_in: 3600,
            })
          }
          if (url.pathname === '/api/auth/oauth2/revoke' && request.method === 'POST') {
            return new Response(null, { status: 200 })
          }
          return new Response('Unexpected OIDC request.', { status: 502 })
        },
      },
    })),
  ],
  test: {
    exclude: [...configDefaults.exclude, 'tests/browser/**'],
    setupFiles: ['./tests/apply-migrations.ts'],
  },
})

function cdpTestError(status: number, errorType: string, errorMessage: string) {
  return Response.json(
    {
      errorType,
      errorMessage,
      correlationId: 'cdp-test-correlation',
    },
    { status },
  )
}
