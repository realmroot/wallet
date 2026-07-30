# Agent Wallet

Agent Wallet is an independent, OIDC-native wallet SaaS for delegated x402 payments.

Each OIDC user gets one CDP end-user wallet. A user can authorize many Agents with separate total, per-payment, and daily/monthly USDC limits. Agents never receive a wallet private key or a CDP credential: they present a short-lived, DPoP-bound Agent access token, and Agent Wallet applies policy before asking CDP to sign the x402 payment.

The initial network is Base Sepolia (`eip155:84532`) with exact USDC payments. No smart contract is required.

## Trust boundary

- The browser uses Authorization Code + PKCE with any compatible OIDC provider.
- Browser tokens are stored in `localStorage`; Agent Wallet has no login cookie or server session.
- The Worker validates human access tokens against the configured OIDC issuer/JWKS and keys users by `(iss, sub)`.
- FlareAuth is optional. When used as the authorization server for Agent Wallet's `native` API Resource mode, browser and Agent tokens share one issuer and discovery document. The Agent token's top-level `sub` is the authorizing user, the RFC 8693 `act` chain identifies the current Host and stable Agent, and `cnf.jkt` binds the token to DPoP.
- Every Agent payment request requires a fresh DPoP proof. Replayed proofs are rejected.
- Agent Wallet owns wallet mappings, CDP delegated signing, budgets, idempotency, and the payment audit log.
- CDP holds signing authority. Agent Wallet does not store an end-user private key.

## Local setup

Requirements: Node 24+, pnpm 10+, and a running OIDC provider.

```sh
pnpm install
cp .dev.vars.example .dev.vars
pnpm db:migrate
pnpm dev
```

The default app URL is `http://localhost:5174`.

Configure the OIDC provider with:

- a public SPA client using Authorization Code, Refresh Token, and PKCE;
- redirect URI `http://localhost:5174/oidc/callback`;
- CORS origin `http://localhost:5174`;
- an API resource with audience `http://localhost:5174/api`;
- human scopes `wallet:read` and `wallet:manage`;
- Agent scope `wallet:x402:pay`.

Put the generated public client ID in `OIDC_CLIENT_ID`. With FlareAuth, set `OIDC_ISSUER` to `http://localhost:4179/api/auth`. Agent Wallet discovers the signing keys from that issuer's OIDC metadata instead of assuming a JWKS path. Register the Wallet API as an enabled `native` authorization-mode API Resource with the configured `OIDC_AUDIENCE` and the `wallet:read`, `wallet:manage`, and `wallet:x402:pay` scopes.

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

## Agent API flow

Agent Wallet does not ship a product-specific CLI. It publishes an OpenAPI 3.1
contract at `/api` and `/api/openapi.json`, and advertises it with an RFC 8631
`service-desc` link. Restish or another Agent HTTP client discovers the
operations directly:

```sh
restish api connect wallet https://wallet.example.com/api --replace --yes
restish wallet --help
```

FlareAuth's Restish adapter owns the Agent identity, target access token, and
grant-specific DPoP key. The Agent calls its original business API, passes an
unmodified `PaymentRequired` response to `createX402Payment`, completes the
controller budget approval when the Wallet returns `202`, then retries the
business request with the returned payment payload in `PAYMENT-SIGNATURE`.

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
pnpm build
```

The Worker integration suite covers OIDC authentication, CDP wallet metadata, Agent grants, FA-style Agent JWT validation, DPoP binding/replay rejection, budget enforcement, idempotency, and exact Base Sepolia USDC payment signing.
