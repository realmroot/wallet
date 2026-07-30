# Agent Wallet

Agent Wallet is an independent, OIDC-native wallet SaaS for delegated x402 payments.

Each OIDC user gets one CDP end-user wallet. A user can authorize many Agents with separate total, per-payment, and daily/monthly USDC limits, an expiration time, and optional merchant-origin and recipient-address allowlists. The user can pause one Agent or freeze every Agent payment from the Wallet immediately. Agents never receive a wallet private key or a CDP credential: they present a short-lived, DPoP-bound Agent access token, and Agent Wallet applies policy before asking CDP to sign the x402 payment.

The initial network is Base Sepolia (`eip155:84532`) with exact USDC payments. No smart contract is required.

## Trust boundary

- The browser uses Authorization Code + PKCE with any compatible OIDC provider.
- Browser tokens are stored in `localStorage`; Agent Wallet has no login cookie or server session.
- The Worker validates human access tokens against the configured OIDC issuer/JWKS and keys users by `(iss, sub)`.
- Realmroot is optional. When used as the authorization server for Agent Wallet's `native` API Resource mode, browser and Agent tokens share one issuer and discovery document. The Agent token's top-level `sub` is the authorizing user, the RFC 8693 `act` chain identifies the current Host and stable Agent, and `cnf.jkt` binds the token to DPoP.
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
- an API resource with audience `http://localhost:6230/api`;
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

The Web app authenticates to CDP with the same OIDC JWT, creates an EOA, and grants the server a time-bounded signing delegation. The server calls `cdp.endUser.signEvmTypedData`; it cannot export the user's private key.

`SIGNER_MODE=mock` is only for deterministic local regression. Its fixed test key must never be funded or deployed.

Wallet registration is not trusted from the browser. Before storing a wallet,
the Worker asks CDP to prove that the address belongs to the claimed end user
and that CDP's developer-JWT authentication subject matches the current OIDC
`sub`, then reads the real delegation expiry from CDP. CDP users and wallet
addresses are unique within the Wallet service. The dashboard then shows Base
Sepolia USDC/ETH balances, can request CDP faucet funds, and prompts the user to
renew a delegation seven days before expiry.

## Agent API flow

Agent Wallet does not ship a product-specific CLI. It publishes an OpenAPI 3.1
contract at the public `/openapi.json` discovery URL and mirrors it at
`/api` and `/api/openapi.json`. The document's server URL points at the
protected `/api` resource. Keeping discovery outside that resource prefix lets
an Agent inspect the available operations before it has a target access grant.
The API advertises the document with an RFC 8631 `service-desc` link. Restish or another Agent HTTP client discovers the
operations directly:

```sh
restish api connect agent-wallet https://wallet.example.com --replace --yes
restish api set agent-wallet 'command_layout: tags'
restish agent-wallet --help
```

The document includes Restish's declarative `x-cli-config` mapping for the
standard DPoP security scheme. It only selects the generic Realmroot target
authentication adapter; Wallet-specific commands or credentials are not
installed.

This produces a compact, resource-oriented command surface:

```text
restish agent-wallet wallet show
restish agent-wallet budget request
restish agent-wallet budget status <request-id>
restish agent-wallet payment authorize <idempotency-key>
restish agent-wallet payment confirm <payment-id>
```

Before requesting a signature, an Agent can run `restish agent-wallet wallet show` (the
`GET /agent/wallet` operation) to read its delegated budget, restrictions,
payment blockers, and maximum payable atomic USDC amount. The response does not
expose the controller profile, CDP user identifier, wallet balance, or direct
database state.

Realmroot's Restish adapter owns the Agent identity, target access token, and
grant-specific DPoP key. The Agent calls its original business API, passes an
unmodified `PaymentRequired` response to `restish agent-wallet payment authorize`, together with a
stable `Idempotency-Key`. It completes controller budget approval when the
Wallet returns `202`, then retries the business request with the returned
payment payload encoded with the x402 standard Base64 HTTP encoding in
`PAYMENT-SIGNATURE`.

After the business request succeeds, the Agent decodes its `PAYMENT-RESPONSE`
header and passes that object to `restish agent-wallet payment confirm`. The Wallet verifies a
successful Base Sepolia receipt contains the exact USDC transfer from the
user's wallet to the requested merchant before marking the payment settled.
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
It also covers concurrent budget enforcement, stale signing-reservation
recovery, Wallet and grant pause/resume, grant edit/revoke, expiration,
merchant and recipient allowlisting, asset allowlisting, and settlement
recording. The Playwright suite operates the real React dashboard against its
Hono RPC contract.

## Production deployment

The checked-in Wrangler configuration is intentionally Base Sepolia-only and
defaults to the CDP signer. Before deployment:

1. Create a D1 database with `pnpm wrangler d1 create agent-wallet`, replace the
   placeholder `database_id` in `wrangler.jsonc`, and apply migrations with
   `pnpm wrangler d1 migrations apply agent-wallet --remote`.
2. Replace `APP_ORIGIN`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, and `OIDC_AUDIENCE`
   with the deployed URLs and registered OIDC client/resource values.
3. Set `CDP_PROJECT_ID`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and
   `CDP_WALLET_SECRET` with `pnpm wrangler secret put <NAME>`.
4. Run `pnpm check`, then `pnpm deploy`.

`/healthz` is a process liveness probe. `/readyz` additionally checks D1 and
all signer/OIDC configuration needed by the selected mode.
`pnpm deploy` also refuses to publish local HTTP URLs, mock signing, or the
placeholder D1 identifier.

The two-minute scheduled job releases abandoned signing reservations so a
Worker crash cannot permanently consume a budget. D1 batches make the budget
counter and payment reservation transactional. Cloudflare observability is
enabled; configure production log retention and alerts for `request failed`,
`wallet runtime lookup failed`, `expired authorization reconciliation failed`,
and `payment maintenance completed`.
Use D1 Time Travel or scheduled exports for recovery, and apply Cloudflare
rate-limiting rules to `/api/agent/*` and `/api/x402/*` at the public edge.
