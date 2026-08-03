# Agent Wallet

Agent Wallet is an independent, OIDC-native wallet SaaS for delegated x402 payments.

Each OIDC user gets one CDP end user and explicitly chooses an EVM account, a
Solana account, or both. A user can authorize many Agents with separate total,
per-payment, and daily/monthly USDC limits, an expiration time, and optional
merchant-origin and recipient-address allowlists. One Agent grant is a global
cross-chain USDC budget: spending on any enabled chain consumes the same
counters. The user can pause one Agent or freeze every Agent payment from the
Wallet immediately. Agents never receive a private key or CDP credential.

Production supports Base, Polygon, Arbitrum, World Chain, and Solana. Sandbox
supports Base Sepolia, World Sepolia, and Solana Devnet. Each environment has
an independent D1 database. No application smart contract is required.

## Trust boundary

- The browser uses Authorization Code + PKCE with any compatible OIDC provider.
- Browser tokens are stored in `localStorage`; Agent Wallet has no login cookie or server session.
- The Worker validates human access tokens against the configured OIDC issuer/JWKS and keys users by `(iss, sub)`.
- Realmroot is optional. When used as the authorization server for Agent Wallet's `native` API Resource mode, browser and Agent tokens share one issuer and discovery document. The Agent token's top-level `sub` is the authorizing user, its RFC 8693 `act` identifies the stable Agent with `sub_profile: ai_agent`, and `cnf.jkt` binds the token to DPoP. The Wallet resolves the issuer's discovered `agentinfo_endpoint` for the Agent's public name and picture.
- Every Agent payment request requires a fresh DPoP proof. Replayed proofs are rejected.
- Agent Wallet owns wallet mappings, CDP delegated signing, balances, testnet funding, budget policy, idempotency, settlement verification, and the payment audit log.
- A Wallet-wide emergency pause blocks all new signatures. Grant pauses, expiration, merchant origins, recipient addresses, and amount limits are rechecked transactionally before each payment reservation.
- CDP holds signing authority. Agent Wallet does not store an end-user private key.

## Local setup

Requirements: Node 24+, pnpm 10+, and a running OIDC provider.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate
pnpm dev
```

The default app URL is `http://localhost:6230`.

Configure the OIDC provider with:

- a public SPA client using Authorization Code, Refresh Token, and PKCE;
- redirect URIs `http://localhost:6230/oidc/callback` and
  `http://localhost:6230/sandbox/oidc/callback`;
- CORS origin `http://localhost:6230`;
- API resources with audiences `http://localhost:6230/api` and
  `http://localhost:6230/api/sandbox`;
- human scopes `wallet:read` and `wallet:manage`;
- Agent scopes `wallet:read`, `wallet:budget:request`, and `wallet:x402:pay`.

Put the generated public client ID in `OIDC_CLIENT_ID`. With Realmroot, set `OIDC_ISSUER` to `http://localhost:4179/api/auth`. Agent Wallet discovers the signing keys from that issuer's OIDC metadata instead of assuming a JWKS path. Register the Wallet API as an enabled `native` authorization-mode API Resource with the configured `OIDC_AUDIENCE`; Realmroot discovers the Agent-facing scopes from the Wallet OpenAPI document. Register `wallet:read` and `wallet:manage` on the public SPA application.

## CDP setup

Configure a CDP project for Custom Auth. Its OIDC issuer, audience, and JWKS must match the access token supplied by the browser. Then set:

```dotenv
SIGNER_MODE=cdp
CDP_PROJECT_ID=...
CDP_API_KEY_ID=...
CDP_API_KEY_SECRET=...
CDP_WALLET_SECRET=...
```

The Web app authenticates to CDP with the same OIDC JWT. Account creation is
never implicit: the user chooses EVM, Solana, or both in a dialog. One EVM EOA
is reused across EVM networks and one Solana account is reused across Solana
clusters. The server uses delegated `signEvmTypedData` and
`signSolanaTransaction`; it cannot export the user's private key.

`SIGNER_MODE=mock` is only for deterministic local regression. Its fixed test key must never be funded or deployed.

Wallet registration is not trusted from the browser. Before storing a wallet,
the Worker asks CDP to prove that the address belongs to the claimed end user
and that CDP's developer-JWT authentication subject matches the current OIDC
`sub`, then reads the real delegation expiry from CDP. CDP users and wallet
addresses are unique within each Wallet environment. The dashboard shows the
selected network's canonical USDC and native-token balances and prompts the
user to renew a delegation seven days before expiry. CDP faucet funding is
available for Base Sepolia and Solana Devnet; World Sepolia requires external
testnet funding.

## Environments

Both environments are served from one origin:

| Environment | UI | API | Networks | D1 |
| --- | --- | --- | --- | --- |
| Production | `/` | `/api` | Base, Polygon, Arbitrum, World, Solana | `agent-wallet-production` |
| Sandbox | `/sandbox` | `/api/sandbox` | Base Sepolia, World Sepolia, Solana Devnet | `agent-wallet-sandbox` |

Production is intentionally unmarked in routes and names. Sandbox always uses
the explicit `sandbox` marker. Access tokens remain namespaced by environment
because their audiences differ, while one rotating refresh token represents
the shared browser login session. The environment selector exchanges that
session for the target audience before loading the target route, so cached API
data and access tokens cannot cross environments without exposing an
intermediate login page.

The default network has no route marker. Non-default networks use
`/chains/{alias}` in Production and `/sandbox/chains/{alias}` in Sandbox.
`WALLET_NETWORKS` controls visible networks and `PAYMENT_NETWORKS` controls
which of those can authorize payments. The checked-in production
`PAYMENT_NETWORKS` is empty until the sequential Base → Polygon → Arbitrum →
World → Solana rollout is approved. All three Sandbox networks are enabled.

## Agent API flow

Agent Wallet does not ship a product-specific CLI. Its discovery roots are
`/api` and `/api/sandbox`, with explicit OpenAPI 3.1 contracts at
`/api/openapi.json` and `/api/sandbox/openapi.json`. Each API advertises its
matching contract with an RFC 8631 `service-desc` link. The documents use a
relative server URL so a standard OpenAPI client can select the production or
Sandbox base URL without rewriting generated operation paths. Restish or
another Agent HTTP client discovers the operations directly:

```sh
restish api connect agent-wallet https://wallet.realmroot.dev/api --replace --yes
restish api set agent-wallet 'command_layout: tags'
restish api set agent-wallet \
  'profiles.sandbox.base_url: https://wallet.realmroot.dev/api/sandbox'
restish agent-wallet --help
restish -p sandbox agent-wallet --help
```

The generated request schemas use one stable set of platform-supported network
identifiers so the cached contract remains valid when a Restish profile changes
the base URL. The top-level `x-wallet-environment` extension is authoritative
for the networks enabled by the selected endpoint; the server still rejects a
payment network that is not enabled in that environment.

The document declares one standard Realmroot OAuth security scheme with
operation-specific scopes. Restish's declarative `x-cli-config` selects the
generic Realmroot target adapter, which supplies the DPoP-bound access token
and per-request proof. Wallet-specific commands or credentials are not
installed.

This produces a compact, resource-oriented command surface:

```text
restish agent-wallet wallet show
restish -p sandbox agent-wallet wallet show
restish agent-wallet budget request
restish agent-wallet budget status <request-id>
restish agent-wallet payment authorize <idempotency-key> --payment-required <value>
restish agent-wallet payment status <payment-id>
restish agent-wallet payment confirm <payment-id> --payment-response <value>
```

Before requesting a signature, an Agent can run `restish agent-wallet wallet show` (the
`GET /agent/wallet` operation) to read its global delegated budget plus
per-network account, readiness, blockers, and maximum payable atomic USDC
amount. The response does not
expose the controller profile, CDP user identifier, wallet balance, or direct
database state.

Realmroot's Restish adapter owns the Agent identity, target access token, and
grant-specific DPoP key. The Agent calls its original business API and forwards
the `PAYMENT-REQUIRED` response header to
`restish agent-wallet payment authorize`, together with a stable
`Idempotency-Key`. It completes controller budget approval when the Wallet
returns `202`, then retries the business request with the Wallet's returned
`PAYMENT-SIGNATURE` header. JSON request and response fields remain available
for clients that do not expose HTTP headers directly.

After the business request succeeds, the Agent forwards its
`PAYMENT-RESPONSE` header to `restish agent-wallet payment confirm`. The Wallet
verifies a successful EVM ERC-20 or Solana SPL receipt contains the exact
canonical USDC transfer from the user's account to the requested merchant
before marking the payment settled.
At any point the Agent can recover the current state through
`restish agent-wallet payment status` without access to Wallet storage or
signature material.
Reusing the same idempotency key returns the same signed payload without
charging the Agent budget twice; a different business purchase uses a new key.

The Wallet UI never asks the user to type an Agent subject. The subject and
authorizing user are taken only from the validated FA target access token.

## Regression and demos

```sh
pnpm check
pnpm preview
pnpm demo:merchant
```

`demo:merchant` is deterministic and verifies the Base Sepolia EIP-712 signature without broadcasting a transaction. It is the default local end-to-end target at `http://localhost:8788/paid`.

For actual Base Sepolia settlement, fund the provisioned wallet with testnet USDC and run:

```sh
PAY_TO=0xYourTestnetReceiver pnpm demo:merchant:real
```

This uses the public x402 testnet facilitator and broadcasts a testnet transaction. It never uses mainnet funds.

## Quality gates

```sh
pnpm typecheck
pnpm test
pnpm audit --prod
pnpm build
```

The Worker integration suite covers OIDC authentication, CDP wallet metadata,
Agent grants, Realmroot Agent JWT validation, DPoP binding/replay rejection,
budget enforcement, idempotency, and exact Base Sepolia USDC payment signing.
It also covers the network registry, Solana settlement balance changes,
concurrent cross-chain budget enforcement, stale signing-reservation
recovery, Wallet and grant pause/resume, grant edit/revoke, expiration,
merchant and recipient allowlisting, asset allowlisting, and settlement
recording. The Playwright suite operates the real React dashboard against its
Hono RPC contract.

## Production deployment

The checked-in Wrangler configuration targets
`https://wallet.realmroot.dev`, binds separate production and Sandbox D1
databases, and defaults to the CDP signer. Before deployment:

1. Apply pending migrations with `pnpm db:migrate:production --remote` and
   `pnpm db:migrate:sandbox --remote`.
2. Keep public deployment settings in `wrangler.toml`. This includes origins,
   public client/project/API-key identifiers, enabled networks, and
   credential-free RPC endpoints. `APP_BASE_URL`, both OIDC audiences, both
   default networks, and the active environment are derived at runtime.
3. Set `CDP_API_KEY_SECRET` and `CDP_WALLET_SECRET` with
   `pnpm wrangler secret put <NAME>`. Configure `SOLANA_RPC_URL` and
   `SOLANA_DEVNET_RPC_URL` the same way because their provider URLs contain
   API keys.
4. Run `pnpm check`, then `pnpm run deploy`.

The configuration boundary is:

- checked in: application origins, OIDC client metadata, CDP project/key IDs,
  network policy, signer mode, database bindings, and public RPC URLs;
- Wrangler secrets: CDP private signing material;
- conditional secrets: any RPC URL containing a provider API key or access
  token. Remove that binding from `[vars]` before storing it as a secret;
- derived at runtime: environment names, application base URLs, OIDC audiences,
  and default networks.

`/healthz` is a process liveness probe. `/readyz` additionally checks D1 and
all signer/OIDC configuration needed by the selected mode.
`pnpm run deploy` also refuses to publish local HTTP URLs, mock signing,
overlapping D1 identifiers, an unmarked Sandbox route, or inconsistent network
and payment settings.

The two-minute scheduled job releases abandoned signing reservations so a
Worker crash cannot permanently consume a budget. D1 batches make the budget
counter and payment reservation transactional. Cloudflare observability is
enabled; configure production log retention and alerts for `request failed`,
`wallet runtime lookup failed`, `expired authorization reconciliation failed`,
and `payment maintenance completed`.
Use D1 Time Travel or scheduled exports for recovery, and apply Cloudflare
rate-limiting rules to the production and Sandbox Agent/x402 API paths at the
public edge.
