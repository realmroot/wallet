import {
  budgetDecisionSchema,
  faucetRequestSchema,
  grantActionSchema,
  inspectBudgetRequestSchema,
  type PaymentRequired,
  type SettlementResponse,
  type WalletRuntime,
  paymentPayloadSchema,
  paymentRequiredSchema,
  settlementResponseSchema,
  updateGrantSchema,
  updateWalletSchema,
  walletActionSchema,
} from '../shared/contracts'
import { authenticateAgent, authenticateHuman } from './auth'
import {
  getWalletDelegationExpiry,
  getWalletRuntime,
  requestTestnetFunds,
  verifyWalletRegistration,
  walletAsset,
} from './cdp'
import { ApiError, badRequest, forbidden } from './errors'
import {
  exchangeOidcToken,
  oidcRevokeInput,
  oidcTokenInput,
  requireWalletOrigin,
  revokeOidcToken,
} from './oidc'
import {
  actOnWallet,
  actOnGrant,
  completePayment,
  createBudgetRequest,
  decideBudgetRequest,
  failPayment,
  getBudgetRequestForAgent,
  getBudgetRequestForApproval,
  getAgentWalletState,
  getOrCreateUser,
  getPaymentForAgent,
  getPaymentForSettlement,
  overview,
  recordAuditEvent,
  recordSettlementFailure,
  reservePayment,
  revokeGrant,
  settlePayment,
  updateGrantPolicy,
  updateWallet,
} from './repository'
import {
  confirmPaymentSettlementRoute,
  createBudgetRequestRoute,
  createPaymentAuthorizationRoute,
  getAgentWalletRoute,
  getBudgetRequestRoute,
  getPaymentRoute,
} from './routes'
import { buildAgentWallet } from './agent-wallet'
import {
  agentOperations,
  agentScopeCatalog,
  requireAgentOperationPolicy,
  walletScopeCatalog,
} from './agent-policy'
import { verifySettlement } from './settlement'
import { createX402Payment } from './signer'
import {
  defaultWalletNetwork,
  networkPaymentsEnabled,
  walletNetworkDefinition,
  walletNetworkIds,
  walletNetworks,
} from './network'
import { validatePaymentRecipient } from './payment-recipient'
import type { PaymentPayload } from '@x402/core/types'
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http'
import { OpenAPIHono, z } from '@hono/zod-openapi'
import { zValidator } from '@hono/zod-validator'
import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'

type AppEnv = {
  Bindings: Env
  Variables: { requestId: string }
}

export function createApp() {
  const app = new OpenAPIHono<AppEnv>()
  const agentApi = createAgentApi()

  return app
    .get('/healthz', (c) =>
      c.json({
        status: 'ok',
        networks: walletNetworks(c.env).map((network) => network.id),
        signer: c.env.SIGNER_MODE,
      }),
    )
    .get('/readyz', async (c) => {
      const missing = requiredConfiguration(c.env).filter(
        (name) => !(c.env as unknown as Record<string, string | undefined>)[name],
      )
      if (missing.length > 0) {
        return c.json({ status: 'not_ready', missing }, 503)
      }
      await checkDatabaseReadiness(c.env)
      return c.json({ status: 'ready' }, 200)
    })
    .route('/api', createApi(agentApi))
    .onError(handleError)
}

function createApi(agentApi: ReturnType<typeof createAgentApi>) {
  const api = new OpenAPIHono<AppEnv>()

  api.use('*', requestId())
  api.use('*', secureHeaders())
  api.use(
    '*',
    cors({
      origin: (origin, c) => (origin === c.env.APP_ORIGIN ? origin : undefined),
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'DPoP',
        'Idempotency-Key',
        'PAYMENT-REQUIRED',
        'PAYMENT-RESPONSE',
      ],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Link', 'Location', 'PAYMENT-SIGNATURE', 'Retry-After', 'X-Request-Id'],
      maxAge: 86400,
    }),
  )
  api.use(
    '*',
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: 'payload_too_large', message: 'Request body exceeds 64 KiB.' }, 413),
    }),
  )
  api.use('*', async (c, next) => {
    c.header(
      'Link',
      `<${openApiUrl(c.env)}>; rel="service-desc"; type="application/openapi+json"`,
    )
    await next()
  })

  return api.route('/', createHumanApi()).route('/', agentApi).onError(handleError)
}

export function createHumanApi() {
  const api = new Hono<AppEnv>()
  const idParamsSchema = z.object({ id: z.string().min(1) })
  const invalidRequest = () => {
    throw badRequest('Request validation failed.')
  }

  return api
    .get('/config', (c) =>
      c.json(
        {
          appOrigin: c.env.APP_ORIGIN,
          appBaseUrl: c.env.APP_BASE_URL,
          oidcIssuer: c.env.OIDC_ISSUER,
          clientId: c.env.OIDC_CLIENT_ID,
          audience: c.env.OIDC_AUDIENCE,
          agentIssuer: c.env.OIDC_ISSUER,
          defaultNetwork: defaultWalletNetwork(c.env).id,
          networks: walletNetworks(c.env).map((network) => ({
            id: network.id,
            alias: network.alias,
            name: network.name,
            mode: network.mode,
            family: network.family,
            asset: network.asset,
            nativeSymbol: network.nativeSymbol,
            explorerOrigin: network.explorerOrigin,
            paymentsEnabled: networkPaymentsEnabled(c.env, network.id),
            faucetAssets: network.faucetAssets,
          })),
          cdpProjectId: c.env.CDP_PROJECT_ID ?? null,
        },
        200,
      ),
    )
    .post(
      '/oidc/token',
      zValidator('json', oidcTokenInput, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        requireWalletOrigin(c.req.raw, c.env.APP_ORIGIN)
        return c.json(await exchangeOidcToken(c.env, c.req.valid('json')), 200)
      },
    )
    .post(
      '/oidc/revoke',
      zValidator('json', oidcRevokeInput, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        requireWalletOrigin(c.req.raw, c.env.APP_ORIGIN)
        await revokeOidcToken(c.env, c.req.valid('json').token)
        return c.body(null, 204)
      },
    )
    .get('/overview', async (c) => {
      const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:read')
      const user = await getOrCreateUser(c.env.DB, principal)
      const network = selectedRequestNetwork(c)
      const [runtime, delegationExpiresAt] = await Promise.all([
        getWalletRuntime(c.env, user, network.id),
        getWalletDelegationExpiry(c.env, user),
      ])
      if (delegationExpiresAt !== undefined && user.cdpUserId) {
        const changed = user.accounts.filter(
          (account) => account.delegationExpiresAt !== delegationExpiresAt,
        )
        if (changed.length > 0) {
          await updateWallet(c.env.DB, user.id, {
            cdpUserId: user.cdpUserId!,
            accounts: user.accounts.map((account) => ({ ...account, delegationExpiresAt })),
          })
          for (const account of user.accounts) account.delegationExpiresAt = delegationExpiresAt
        }
      }
      return c.json(await overview(c.env.DB, user, runtime), 200)
    })
    .put(
      '/wallet',
      zValidator('json', updateWalletSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const input = c.req.valid('json')
        const verified = await verifyWalletRegistration(c.env, {
          ...input,
          oidcSubject: principal.subject,
        })
        await updateWallet(c.env.DB, user.id, { ...input, ...verified })
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: 'wallet.registered',
          targetType: 'wallet',
          targetId: user.id,
          metadata: {
            accounts: input.accounts.map((account) => ({
              family: account.family,
              address: account.address,
            })),
          },
        })
        return c.body(null, 204)
      },
    )
    .post(
      '/wallet/actions',
      zValidator('json', walletActionSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const input = c.req.valid('json')
        await actOnWallet(c.env.DB, user.id, input.action)
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: `wallet.${input.action}d`,
          targetType: 'wallet',
          targetId: user.id,
        })
        return c.body(null, 204)
      },
    )
    .post(
      '/wallet/faucet',
      zValidator('json', faucetRequestSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const result = await requestTestnetFunds(c.env, user, c.req.valid('json'))
        const faucetInput = c.req.valid('json')
        const account = user.accounts.find(
          (candidate) => candidate.family === walletNetworkDefinition(faucetInput.network).family,
        )
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: 'wallet.faucet_requested',
          targetType: 'wallet',
          targetId: account?.id ?? user.id,
          metadata: faucetInput,
        })
        return c.json({ transactionHash: result.transactionHash }, 200)
      },
    )
    .post(
      '/budget-requests/:id/inspect',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      zValidator('json', inspectBudgetRequestSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const input = c.req.valid('json')
        return c.json(
          await getBudgetRequestForApproval(c.env.DB, c.req.valid('param').id, input.approvalToken, principal),
          200,
        )
      },
    )
    .put(
      '/grants/:id',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      zValidator('json', updateGrantSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const grantId = c.req.valid('param').id
        await updateGrantPolicy(c.env.DB, user.id, grantId, c.req.valid('json'))
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: 'grant.updated',
          targetType: 'grant',
          targetId: grantId,
          metadata: c.req.valid('json'),
        })
        return c.body(null, 204)
      },
    )
    .post(
      '/grants/:id/actions',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      zValidator('json', grantActionSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const grantId = c.req.valid('param').id
        const input = c.req.valid('json')
        await actOnGrant(c.env.DB, user.id, grantId, input)
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: `grant.${input.action}d`,
          targetType: 'grant',
          targetId: grantId,
        })
        return c.body(null, 204)
      },
    )
    .put(
      '/budget-requests/:id/decision',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      zValidator('json', budgetDecisionSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const input = c.req.valid('json')
        const requestId = c.req.valid('param').id
        const result = await decideBudgetRequest(c.env.DB, requestId, principal, input)
        const user = await getOrCreateUser(c.env.DB, principal)
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: `budget_request.${input.decision === 'approve' ? 'approved' : 'denied'}`,
          targetType: 'budget_request',
          targetId: requestId,
          metadata:
            result.grantId && input.decision === 'approve'
              ? {
                  grantId: result.grantId,
                  name: input.name,
                  totalLimit: input.totalLimit,
                  perTransactionLimit: input.perTransactionLimit,
                  periodKind: input.periodKind,
                  periodLimit: input.periodLimit,
                  allowedOrigins: input.allowedOrigins,
                  allowedRecipients: input.allowedRecipients,
                  expiresAt: input.expiresAt,
                }
              : undefined,
        })
        return c.json(result, 200)
      },
    )
    .delete(
      '/grants/:id',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        const grantId = c.req.valid('param').id
        await revokeGrant(c.env.DB, user.id, grantId)
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: 'grant.revoked',
          targetType: 'grant',
          targetId: grantId,
        })
        return c.body(null, 204)
      },
    )
}

export type HumanApiType = ReturnType<typeof createHumanApi>

function createAgentApi() {
  const api = openApiRouter()
  api.openAPIRegistry.registerComponent('securitySchemes', 'RealmrootOAuth', {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://realmroot.invalid/api/auth/oauth2/authorize',
        tokenUrl: 'https://realmroot.invalid/api/auth/oauth2/token',
        scopes: walletScopeCatalog,
      },
    },
    description:
      'Realmroot OAuth access token. Agent requests use a DPoP-bound token and a per-request DPoP proof.',
  })

  const routes = api
    .openapi(getAgentWalletRoute, async (c) => {
      const principal = await authenticateAgent(
        c.req.raw,
        c.env,
        getAgentWalletRoute.operationId,
      )
      const state = await getAgentWalletState(c.env.DB, principal)
      const [walletRuntimes, delegationExpiresAt]: [
        WalletRuntime[],
        string | null | undefined,
      ] =
        state.user && state.grants.length > 0
          ? await Promise.all([
              Promise.all(
                walletNetworks(c.env)
                  .filter((network) => networkPaymentsEnabled(c.env, network.id))
                  .map((network) => getWalletRuntime(c.env, state.user!, network.id)),
              ),
              getWalletDelegationExpiry(c.env, state.user),
            ])
          : [[], undefined]
      if (delegationExpiresAt !== undefined && state.user?.cdpUserId) {
        const changed = state.user.accounts.some(
          (account) => account.delegationExpiresAt !== delegationExpiresAt,
        )
        if (changed) {
          await updateWallet(c.env.DB, state.user.id, {
            cdpUserId: state.user.cdpUserId!,
            accounts: state.user.accounts.map((account) => ({
              ...account,
              delegationExpiresAt,
            })),
          })
          for (const account of state.user.accounts) account.delegationExpiresAt = delegationExpiresAt
        }
      }
      return c.json(
        buildAgentWallet(
          c.env,
          state.user,
          state.grants,
          walletRuntimes,
        ),
        200,
      )
    })
    .openapi(createBudgetRequestRoute, async (c) => {
      const principal = await authenticateAgent(
        c.req.raw,
        c.env,
        createBudgetRequestRoute.operationId,
      )
      const input = c.req.valid('json')
      const result = await createBudgetRequest(
        c.env.DB,
        principal,
        walletModeBaseUrl(c.env, input.mode),
        input.mode,
        input.name,
      )
      if (result.status !== 'pending') return c.json(result, 200)
      setBudgetRequestHeaders(c, result)
      return c.json(result, 201)
    })
    .openapi(getBudgetRequestRoute, async (c) => {
      const principal = await authenticateAgent(
        c.req.raw,
        c.env,
        getBudgetRequestRoute.operationId,
      )
      return c.json(
        await getBudgetRequestForAgent(c.env.DB, c.req.valid('param').requestId, principal),
        200,
      )
    })
    .openapi(createPaymentAuthorizationRoute, async (c) => {
      const principal = await authenticateAgent(
        c.req.raw,
        c.env,
        createPaymentAuthorizationRoute.operationId,
      )
      const headers = c.req.valid('header')
      const hasJsonBody = isJsonRequest(c.req.raw)
      const paymentRequired = paymentRequiredInput(
        hasJsonBody ? (c.req.valid('json') as PaymentRequired) : undefined,
        headers['payment-required'],
        hasJsonBody,
      )
      const idempotencyKey = headers['idempotency-key']
      const accepted = selectRequirement(paymentRequired, c.env)
      if (!networkPaymentsEnabled(c.env, accepted.network)) {
        throw forbidden(`Payments are disabled on ${accepted.network}.`)
      }
      const mode = walletNetworkDefinition(accepted.network).mode
      const budget = await createBudgetRequest(
        c.env.DB,
        principal,
        walletModeBaseUrl(c.env, mode),
        mode,
      )
      if (budget.status !== 'approved') {
        setBudgetRequestHeaders(c, budget)
        return c.json(budget, 202)
      }

      await validatePaymentRecipient(c.env, accepted.network, accepted.payTo)
      const requirementHash = await hashRequirement(paymentRequired)
      const reservation = await reservePayment(c.env.DB, {
        owner: principal.owner,
        agent: principal.agent,
        requirementHash,
        network: accepted.network,
        asset: accepted.asset,
        amount: accepted.amount,
        payTo: accepted.payTo,
        resource: paymentRequired.resource.url,
        idempotencyKey,
      })
      if (reservation.kind === 'signed') {
        c.header(
          'PAYMENT-SIGNATURE',
          encodePaymentSignatureHeader(reservation.paymentPayload as PaymentPayload),
        )
        return c.json(
          {
            paymentId: reservation.paymentId,
            paymentPayload: paymentPayloadSchema.parse(reservation.paymentPayload),
            replayed: true,
          },
          200,
        )
      }
      try {
        const payload = paymentPayloadSchema.parse(
          await createX402Payment(c.env, {
            cdpUserId: reservation.user.cdpUserId!,
            account: reservation.account,
            network: accepted.network,
            paymentRequired,
            idempotencyKey: reservation.paymentId,
          }),
        )
        await completePayment(c.env.DB, reservation.paymentId, payload)
        await recordAuditEvent(c.env.DB, {
          userId: reservation.user.id,
          actorKind: 'agent',
          actorSubject: principal.agent.subject,
          action: 'payment.signed',
          targetType: 'payment',
          targetId: reservation.paymentId,
          metadata: {
            amount: accepted.amount,
            network: accepted.network,
            family: reservation.account.family,
            resource: paymentRequired.resource.url,
          },
        })
        c.header('PAYMENT-SIGNATURE', encodePaymentSignatureHeader(payload))
        return c.json(
          {
            paymentId: reservation.paymentId,
            paymentPayload: payload,
            replayed: reservation.replayed,
          },
          200,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Wallet signing failed.'
        await failPayment(c.env.DB, reservation.paymentId, reservation.grantId, accepted.amount, message)
        await recordAuditEvent(c.env.DB, {
          userId: reservation.user.id,
          actorKind: 'agent',
          actorSubject: principal.agent.subject,
          action: 'payment.signing_failed',
          targetType: 'payment',
          targetId: reservation.paymentId,
          metadata: {
            amount: accepted.amount,
            network: accepted.network,
            family: reservation.account.family,
            resource: paymentRequired.resource.url,
          },
        })
        throw error
      }
    })
    .openapi(getPaymentRoute, async (c) => {
      const principal = await authenticateAgent(c.req.raw, c.env, getPaymentRoute.operationId)
      return c.json(
        await getPaymentForAgent(c.env.DB, c.req.valid('param').paymentId, principal),
        200,
      )
    })
    .openapi(confirmPaymentSettlementRoute, async (c) => {
      const principal = await authenticateAgent(
        c.req.raw,
        c.env,
        confirmPaymentSettlementRoute.operationId,
      )
      const paymentId = c.req.valid('param').paymentId
      const hasJsonBody = isJsonRequest(c.req.raw)
      const response = paymentResponseInput(
        hasJsonBody ? (c.req.valid('json') as SettlementResponse) : undefined,
        c.req.valid('header')['payment-response'],
        hasJsonBody,
      )
      const payment = await getPaymentForSettlement(c.env.DB, paymentId, principal)
      await verifySettlement(c.env, payment, response)
      if (response.success) {
        await settlePayment(c.env.DB, paymentId, response)
      } else {
        await recordSettlementFailure(c.env.DB, paymentId, response)
      }
      await recordAuditEvent(c.env.DB, {
        userId: payment.user_id,
        actorKind: 'agent',
        actorSubject: principal.agent.subject,
        action: response.success ? 'payment.settled' : 'payment.settlement_failed',
        targetType: 'payment',
        targetId: paymentId,
        metadata: response.success ? { transactionHash: response.transaction } : undefined,
      })
      return c.json(
        {
          paymentId,
          status: response.success ? ('settled' as const) : ('signed' as const),
          transactionHash: response.success ? response.transaction : null,
        },
        200,
      )
    })

  routes.get('/', (c) => c.json(agentApiOpenApi(api, c.env)))
  routes.get('/openapi.json', (c) =>
    c.json(agentApiOpenApi(api, c.env)),
  )
  routes.onError(handleError)
  return api
}

function agentApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Wallet API',
      version: '1.0.0',
      description:
        'A DPoP-protected x402 payer for delegated Agents. Inspect the delegated Wallet, request a budget, authorize payments, and confirm merchant settlements.',
    },
    servers: [{ url: '.' }],
    tags: [
      { name: 'wallet', description: 'Inspect the Wallet delegated to the current Agent.' },
      { name: 'budget', description: 'Request and track controller-approved spending budgets.' },
      { name: 'payment', description: 'Authorize x402 payments and confirm merchant settlements.' },
    ],
    'x-x402': {
      role: 'payer',
      paymentOperationId: agentOperations.createPaymentAuthorization.operationId,
      settlementOperationId: agentOperations.confirmPaymentSettlement.operationId,
      trigger: 'HTTP 402 Payment Required',
      headers: {
        paymentRequired: 'PAYMENT-REQUIRED',
        paymentSignature: 'PAYMENT-SIGNATURE',
        paymentResponse: 'PAYMENT-RESPONSE',
      },
    },
    'x-agent-auth': {
      scheme: 'DPoP',
      provider: 'Realmroot',
      managedBy: 'Restish authentication adapter',
    },
    'x-cli-config': {
      profiles: {
        default: {
          credentials: {
            RealmrootOAuth: {
              auth: {
                type: 'api-key',
                params: {
                  in: 'header',
                  name: 'Authorization',
                  value: 'DPoP',
                  provider: 'realmroot-target',
                  scopes: Object.keys(agentScopeCatalog).join(' '),
                },
              },
              params: {
                provider: 'realmroot-target',
              },
            },
          },
        },
      },
    },
  }
}

function setBudgetRequestHeaders(
  c: Context<AppEnv>,
  request: { requestId: string | null; pollIntervalSeconds?: number },
) {
  if (!request.requestId) throw new Error('A pending budget request must have a request ID.')
  c.header('Location', `${c.env.OIDC_AUDIENCE}/agent/budget-requests/${request.requestId}`)
  c.header('Retry-After', String(request.pollIntervalSeconds ?? 3))
}

function paymentRequiredInput(
  json: PaymentRequired | undefined,
  header: string | undefined,
  hasJsonBody: boolean,
) {
  if (hasJsonBody && header) {
    throw badRequest('Provide PaymentRequired as JSON or PAYMENT-REQUIRED, not both.')
  }
  if (!json && !header) throw badRequest('PaymentRequired JSON or PAYMENT-REQUIRED is required.')
  if (json) return json
  return decodeX402Header(header!, decodePaymentRequiredHeader, paymentRequiredSchema, 'PAYMENT-REQUIRED')
}

function paymentResponseInput(
  json: SettlementResponse | undefined,
  header: string | undefined,
  hasJsonBody: boolean,
) {
  if (hasJsonBody && header) {
    throw badRequest('Provide SettleResponse as JSON or PAYMENT-RESPONSE, not both.')
  }
  if (!json && !header) throw badRequest('SettleResponse JSON or PAYMENT-RESPONSE is required.')
  if (json) return json
  return decodeX402Header(header!, decodePaymentResponseHeader, settlementResponseSchema, 'PAYMENT-RESPONSE')
}

function decodeX402Header<T>(
  header: string,
  decode: (value: string) => unknown,
  schema: z.ZodType<T>,
  name: string,
) {
  let decoded: unknown
  try {
    decoded = decode(header)
  } catch {
    throw badRequest(`${name} is not valid x402 Base64 JSON.`)
  }
  const result = schema.safeParse(decoded)
  if (!result.success) throw badRequest(`${name} does not contain a valid x402 object.`)
  return result.data
}

function isJsonRequest(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim() === 'application/json'
}

function agentApiOpenApi(
  api: Pick<OpenAPIHono<AppEnv>, 'getOpenAPI31Document'>,
  env: Env,
) {
  const document = api.getOpenAPI31Document(agentApiDocument())
  constrainOpenApiNetworks(document)
  const scheme = document.components?.securitySchemes?.RealmrootOAuth
  if (scheme && 'flows' in scheme && scheme.flows?.authorizationCode) {
    scheme.flows.authorizationCode.authorizationUrl = `${env.OIDC_ISSUER}/oauth2/authorize`
    scheme.flows.authorizationCode.tokenUrl = `${env.OIDC_ISSUER}/oauth2/token`
  }
  for (const path of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = path?.[method]
      if (!operation?.security?.some((requirement) => 'RealmrootOAuth' in requirement)) continue
      if (!operation.operationId) throw new Error('An Agent operation must define operationId.')
      const policy = requireAgentOperationPolicy(operation.operationId)
      operation.security = [{ RealmrootOAuth: [policy.scope] }]
    }
  }
  return document
}

type MutableOpenApiSchema = {
  properties?: Record<string, MutableOpenApiSchema>
  items?: MutableOpenApiSchema
  enum?: string[]
  example?: string
}

function constrainOpenApiNetworks(
  document: ReturnType<OpenAPIHono<AppEnv>['getOpenAPI31Document']>,
) {
  const schemas = document.components?.schemas as
    | Record<string, MutableOpenApiSchema>
    | undefined
  const networkSchemas = [
    schemas?.AgentWallet?.properties?.networks?.items?.properties?.network,
    schemas?.PaymentRequired?.properties?.accepts?.items?.properties?.network,
    schemas?.PaymentResult?.properties?.paymentPayload?.properties?.accepted?.properties?.network,
    schemas?.AgentPayment?.properties?.network,
    schemas?.SettlementResponse?.properties?.network,
  ]
  if (networkSchemas.some((schema) => !schema)) {
    throw new Error('Agent OpenAPI network schemas are incomplete.')
  }

  const networks = [...walletNetworkIds]
  const example = walletNetworkIds[0]
  for (const schema of networkSchemas) {
    schema!.enum = networks
    schema!.example = example
  }
}

function openApiRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw badRequest('Request validation failed.')
    },
  })
}

function handleError(error: Error, c: Context<AppEnv>) {
  const apiError = error instanceof ApiError ? error : undefined
  console.error(
    JSON.stringify({
      message: 'request failed',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: apiError?.status ?? 500,
      errorCode: apiError?.code ?? 'internal_error',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        diagnostics: apiError?.diagnostics,
      },
    }),
  )
  if (error instanceof ApiError) {
    for (const [name, value] of new Headers(error.headers)) c.header(name, value)
    return c.json({ error: error.code, message: error.message }, error.status)
  }
  return c.json({ error: 'internal_error', message: 'The request failed.' }, 500)
}

function selectRequirement(paymentRequired: PaymentRequired, env: Env) {
  const enabled = new Map<string, ReturnType<typeof walletNetworks>[number]>(
    walletNetworks(env).map((network) => [network.id, network]),
  )
  const accepted = paymentRequired.accepts.find((candidate) => {
    const network = enabled.get(candidate.network)
    if (!network || candidate.scheme !== 'exact') return false
    const asset = walletAsset(network.id).address
    return network.family === 'evm'
      ? candidate.asset.toLowerCase() === asset.toLowerCase()
      : candidate.asset === asset
  })
  if (!accepted) {
    throw badRequest(
      'No supported exact canonical USDC payment requirement was provided for an enabled network.',
    )
  }
  return accepted
}

async function hashRequirement(paymentRequired: PaymentRequired) {
  const normalized = JSON.stringify(paymentRequired, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    }
    return value
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function requiredConfiguration(env: Env) {
  const common = [
    'APP_ORIGIN',
    'APP_BASE_URL',
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_AUDIENCE',
    'DEFAULT_WALLET_NETWORK',
    'WALLET_NETWORKS',
  ]
  return env.SIGNER_MODE === 'mock'
    ? [...common, 'MOCK_SIGNER_PRIVATE_KEY']
    : [
        ...common,
        ...walletNetworks(env).map((network) => String(network.rpcBinding)),
        'CDP_PROJECT_ID',
        'CDP_API_KEY_ID',
        'CDP_API_KEY_SECRET',
        'CDP_WALLET_SECRET',
      ]
}

function openApiUrl(env: Env) {
  return `${env.OIDC_AUDIENCE}/openapi.json`
}

function checkDatabaseReadiness(env: Env) {
  return env.DB.batch([
    env.DB.prepare('SELECT paused_at FROM wallet_user LIMIT 1'),
    env.DB.prepare('SELECT allowed_origins, allowed_recipients FROM agent_grant LIMIT 1'),
    env.DB.prepare('SELECT transaction_hash, authorization_expires_at, account_id FROM payment LIMIT 1'),
    env.DB.prepare('SELECT family, address, delegation_expires_at FROM wallet_account LIMIT 1'),
    env.DB.prepare('SELECT id FROM audit_event LIMIT 1'),
  ])
}

function selectedRequestNetwork(c: Context<AppEnv>) {
  const requested = c.req.query('network')
  if (!requested) return defaultWalletNetwork(c.env)
  const selected = walletNetworks(c.env).find((network) => network.id === requested)
  if (!selected) throw badRequest('The requested Wallet network is not enabled.')
  return selected
}

function walletModeBaseUrl(env: Env, mode: 'production' | 'sandbox') {
  return mode === 'sandbox' ? `${env.APP_ORIGIN}/sandbox` : env.APP_ORIGIN
}
