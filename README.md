# Agent Wallet

Agent Wallet is an independent, OIDC-native wallet SaaS for delegated x402 payments.

Each OIDC user gets one CDP end user and explicitly chooses an EVM account, a
Solana account, or both. A user can authorize many Agents with separate total,
per-payment, and daily/monthly USDC limits, an expiration time, and optional
merchant-origin and recipient-address allowlists. Each Agent can have one
Production grant and one Sandbox grant. Spending is shared across the chains
inside that product mode, while Production and Sandbox counters remain
independent. The user can pause one Agent or freeze every Agent payment from
the Wallet immediately. Agents never receive a private key or CDP credential.

Production supports Base, Polygon, Arbitrum, World Chain, and Solana. Sandbox
supports Base Sepolia, World Sepolia, and Solana Devnet. Both product modes use
one deployment and one D1 database. No application smart contract is required.

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
- redirect URI `http://localhost:6230/oidc/callback`;
- CORS origin `http://localhost:6230`;
- one API resource with audience `http://localhost:6230/api`;
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
addresses are unique within the Wallet. The dashboard shows the
selected network's canonical USDC and native-token balances and prompts the
user to renew a delegation seven days before expiry. CDP faucet funding is
available for Base Sepolia and Solana Devnet; World Sepolia requires external
testnet funding.

## Product modes

Production and Sandbox are two views of one Wallet service:

| Mode | UI | API | Networks | Budget |
| --- | --- | --- | --- | --- |
| Production | `/` | `/api` | Base, Polygon, Arbitrum, World, Solana | Production grant |
| Sandbox | `/sandbox` | `/api` | Base Sepolia, World Sepolia, Solana Devnet | Sandbox grant |

The mode selector changes only the product view and selected network family.
Both views use the same OIDC session, access token, API audience, stable Agent
identity, user record, CDP user, EVM address, and Solana address. Network IDs
distinguish mainnet data from testnet data. Agent grants and their spend
counters carry an explicit mode so Sandbox activity cannot consume a
Production budget, or vice versa.

The default network has no route marker. Non-default networks use
`/chains/{alias}` in Production and `/sandbox/chains/{alias}` in Sandbox.
`WALLET_NETWORKS` controls visible networks and `PAYMENT_NETWORKS` controls
which of those can authorize payments. The checked-in configuration enables
all three Sandbox networks. Mainnet payment signing remains disabled until its
sequential Base → Polygon → Arbitrum → World → Solana rollout is approved.

## Agent API flow

Agent Wallet does not ship a product-specific CLI. Its single discovery root
is `/api`, with an explicit OpenAPI 3.1 contract at `/api/openapi.json`. The API
advertises that contract with an RFC 8631 `service-desc` link. Restish or
another Agent HTTP client discovers the operations directly:

```sh
restish api connect agent-wallet https://wallet.realmroot.dev/api --replace --yes
restish api set agent-wallet 'command_layout: tags'
restish agent-wallet --help
```

The generated request schemas use one stable set of platform-supported network
identifiers. A budget request includes `mode: production | sandbox`; an x402
payment identifies its chain with the standard network ID. The server derives
the payment mode from that network and applies only the matching grant.

The document declares one standard Realmroot OAuth security scheme with
operation-specific scopes. Restish's declarative `x-cli-config` selects the
generic Realmroot target adapter, which supplies the DPoP-bound access token
and per-request proof. Wallet-specific commands or credentials are not
installed.

This produces a compact, resource-oriented command surface:

```text
restish agent-wallet wallet show
restish agent-wallet budget request --mode sandbox
restish agent-wallet budget status <request-id>
restish agent-wallet payment authorize <idempotency-key> --payment-required <value>
restish agent-wallet payment status <payment-id>
restish agent-wallet payment confirm <payment-id> --payment-response <value>
```

Before requesting a signature, an Agent can run `restish agent-wallet wallet show` (the
`GET /agent/wallet` operation) to read its mode-scoped delegated budgets plus
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
`https://wallet.realmroot.dev`, binds one D1 database, and defaults to the CDP
signer. Before deployment:

1. Apply pending migrations with `pnpm db:migrate:production --remote`.
   Migration `0006_wallet_modes.sql` classifies existing rows in the retained
   database as Production. A deployment upgrading from the former two-D1
   topology must explicitly import the legacy Sandbox accounts and records
   with `mode = 'sandbox'` during the Worker cutover; the schema migration
   cannot copy data across D1 databases by itself.
2. Keep public deployment settings in `wrangler.toml`. This includes origins,
   public client/project/API-key identifiers, enabled networks, and
   credential-free RPC endpoints. `APP_BASE_URL`, the OIDC audience, and the
   default network are derived at runtime.
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
- derived at runtime: the application base URL, OIDC audience, and default network.

`/healthz` is a process liveness probe. `/readyz` additionally checks D1 and
all signer/OIDC configuration needed by the Wallet service.
`pnpm run deploy` also refuses to publish local HTTP URLs, mock signing,
or inconsistent network and payment settings.

The two-minute scheduled job releases abandoned signing reservations so a
Worker crash cannot permanently consume a budget. D1 batches make the budget
counter and payment reservation transactional. Cloudflare observability is
enabled; configure production log retention and alerts for `request failed`,
`wallet runtime lookup failed`, `expired authorization reconciliation failed`,
and `payment maintenance completed`.
Use D1 Time Travel or scheduled exports for recovery, and apply Cloudflare
rate-limiting rules to the Agent/x402 API path at the public edge.
