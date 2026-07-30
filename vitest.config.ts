import path from 'node:path'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

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
          OIDC_ISSUER: 'https://fa.test/api/auth',
          OIDC_CLIENT_ID: 'agent-wallet-web',
          OIDC_AUDIENCE: 'https://wallet.test/api',
          WALLET_NETWORK: 'eip155:84532',
          SIGNER_MODE: 'mock',
          MOCK_SIGNER_PRIVATE_KEY: mockSignerPrivateKey,
          OIDC_JWKS: oidcJwks,
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
        },
      },
    })),
  ],
  test: {
    setupFiles: ['./tests/apply-migrations.ts'],
  },
})
