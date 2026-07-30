import {
  budgetDecisionSchema,
  faucetRequestSchema,
  grantActionSchema,
  inspectBudgetRequestSchema,
  type PaymentRequired,
  settlementResponseSchema,
  updateGrantSchema,
  updateWalletSchema,
  walletActionSchema,
} from '../shared/contracts'
import { authenticateAgent, authenticateHuman } from './auth'
import {
  getWalletRuntime,
  requestTestnetFunds,
  verifyWalletRegistration,
  walletAsset,
} from './cdp'
import { ApiError, badRequest } from './errors'
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
  getOrCreateUser,
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
  createBudgetRequestRoute,
  createX402PaymentRoute,
  getBudgetRequestRoute,
  reportSettlementRoute,
} from './routes'
import { verifySettlement } from './settlement'
import { createX402Payment } from './signer'
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
        network: c.env.WALLET_NETWORK,
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
      await c.env.DB.batch([
        c.env.DB.prepare('SELECT paused_at FROM wallet_user LIMIT 1'),
        c.env.DB.prepare('SELECT allowed_origins, allowed_recipients FROM agent_grant LIMIT 1'),
        c.env.DB.prepare('SELECT transaction_hash, authorization_expires_at FROM payment LIMIT 1'),
        c.env.DB.prepare('SELECT id FROM audit_event LIMIT 1'),
      ])
      return c.json({ status: 'ready' }, 200)
    })
    .get('/openapi.json', (c) => {
      c.header(
        'Link',
        `<${c.env.APP_ORIGIN}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
      )
      return c.json(agentApiOpenApi(agentApi, c.env.APP_ORIGIN, c.env.OIDC_ISSUER))
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
      allowHeaders: ['Authorization', 'Content-Type', 'DPoP', 'Idempotency-Key'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['Link', 'PAYMENT-SIGNATURE', 'X-Request-Id'],
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
      `<${c.env.APP_ORIGIN}/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
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
          oidcIssuer: c.env.OIDC_ISSUER,
          clientId: c.env.OIDC_CLIENT_ID,
          audience: c.env.OIDC_AUDIENCE,
          agentIssuer: c.env.OIDC_ISSUER,
          network: c.env.WALLET_NETWORK,
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
      const { runtime, delegationExpiresAt } = await getWalletRuntime(c.env, user)
      if (delegationExpiresAt && delegationExpiresAt !== user.delegationExpiresAt) {
        await updateWallet(c.env.DB, user.id, {
          cdpUserId: user.cdpUserId!,
          address: user.walletAddress!,
          delegationExpiresAt,
        })
        user.delegationExpiresAt = delegationExpiresAt
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
          targetId: input.address.toLowerCase(),
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
          targetId: user.walletAddress ?? user.id,
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
        await recordAuditEvent(c.env.DB, {
          userId: user.id,
          actorKind: 'human',
          actorSubject: principal.subject,
          action: 'wallet.faucet_requested',
          targetType: 'wallet',
          targetId: user.walletAddress!,
          metadata: { token: c.req.valid('json').token },
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
  api.openAPIRegistry.registerComponent('securitySchemes', 'DPoP', {
    type: 'http',
    scheme: 'DPoP',
    bearerFormat: 'JWT',
    description:
      'A FlareAuth target access token bound to the public key in the per-request DPoP proof.',
  })
  api.openAPIRegistry.registerComponent('securitySchemes', 'ScopeCatalog', {
    type: 'oauth2',
    flows: {
      authorizationCode: {
        authorizationUrl: 'https://realmroot.invalid/api/auth/oauth2/authorize',
        tokenUrl: 'https://realmroot.invalid/api/auth/oauth2/token',
        scopes: {
          'wallet:x402:pay': 'Create x402 payments within a controller-approved Agent budget.',
        },
      },
    },
    description:
      'OAuth scope catalog used by FlareAuth authorization discovery. Runtime requests use the DPoP security scheme.',
  })

  const routes = api
    .openapi(createBudgetRequestRoute, async (c) => {
      const principal = await authenticateAgent(c.req.raw, c.env)
      const input = c.req.valid('json')
      const result = await createBudgetRequest(c.env.DB, principal, c.env.APP_ORIGIN, input.name)
      return result.status === 'pending' ? c.json(result, 201) : c.json(result, 200)
    })
    .openapi(getBudgetRequestRoute, async (c) => {
      const principal = await authenticateAgent(c.req.raw, c.env)
      return c.json(await getBudgetRequestForAgent(c.env.DB, c.req.valid('param').id, principal), 200)
    })
    .openapi(createX402PaymentRoute, async (c) => {
      const principal = await authenticateAgent(c.req.raw, c.env)
      const paymentRequired = c.req.valid('json')
      const idempotencyKey = c.req.valid('header')['idempotency-key']
      const budget = await createBudgetRequest(c.env.DB, principal, c.env.APP_ORIGIN)
      if (budget.status !== 'approved') return c.json(budget, 202)

      const accepted = selectRequirement(paymentRequired, c.env)
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
        return c.json(
          {
            paymentId: reservation.paymentId,
            paymentPayload: reservation.paymentPayload,
            replayed: true,
          },
          200,
        )
      }
      try {
        const payload = await createX402Payment(c.env, {
          cdpUserId: reservation.user.cdpUserId!,
          address: reservation.user.walletAddress as `0x${string}`,
          paymentRequired,
          idempotencyKey: reservation.paymentId,
        })
        await completePayment(c.env.DB, reservation.paymentId, payload)
        await recordAuditEvent(c.env.DB, {
          userId: reservation.user.id,
          actorKind: 'agent',
          actorSubject: principal.agent.subject,
          action: 'payment.signed',
          targetType: 'payment',
          targetId: reservation.paymentId,
          metadata: { amount: accepted.amount, resource: paymentRequired.resource.url },
        })
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
          metadata: { amount: accepted.amount, resource: paymentRequired.resource.url },
        })
        throw error
      }
    })
    .openapi(reportSettlementRoute, async (c) => {
      const principal = await authenticateAgent(c.req.raw, c.env)
      const paymentId = c.req.valid('param').id
      const response = c.req.valid('json')
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

  routes.get('/', (c) => c.json(agentApiOpenApi(api, c.env.APP_ORIGIN, c.env.OIDC_ISSUER)))
  routes.get('/openapi.json', (c) =>
    c.json(agentApiOpenApi(api, c.env.APP_ORIGIN, c.env.OIDC_ISSUER)),
  )
  routes.onError(handleError)
  return api
}

function agentApiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Wallet API',
      version: '1.0.0',
      description:
        'An x402 payer for delegated Agents. When a business API returns HTTP 402, call createX402Payment with its PaymentRequired object and a stable Idempotency-Key. Encode the signed payload with the standard x402 Base64 HTTP encoder, retry the business API, then decode and submit its PAYMENT-RESPONSE to reportX402Settlement.',
    },
    servers: [{ url: `${origin}/api` }],
    tags: [{ name: 'Agent', description: 'DPoP-bound operations used by Agents.' }],
    'x-x402': {
      role: 'payer',
      paymentOperationId: 'createX402Payment',
      settlementOperationId: 'reportX402Settlement',
      trigger: 'HTTP 402 Payment Required',
    },
    'x-agent-auth': {
      scheme: 'DPoP',
      provider: 'FlareAuth',
      managedBy: 'Restish authentication adapter',
    },
    'x-cli-config': {
      profiles: {
        default: {
          credentials: {
            DPoP: {
              auth: {
                type: 'api-key',
                params: {
                  in: 'header',
                  name: 'Authorization',
                  value: 'DPoP',
                  provider: 'realmroot-target',
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

function agentApiOpenApi(
  api: Pick<OpenAPIHono<AppEnv>, 'getOpenAPI31Document'>,
  origin: string,
  oidcIssuer: string,
) {
  const document = api.getOpenAPI31Document(agentApiDocument(origin))
  const scheme = document.components?.securitySchemes?.ScopeCatalog
  if (scheme && 'flows' in scheme && scheme.flows?.authorizationCode) {
    scheme.flows.authorizationCode.authorizationUrl = `${oidcIssuer}/oauth2/authorize`
    scheme.flows.authorizationCode.tokenUrl = `${oidcIssuer}/oauth2/token`
  }
  for (const path of Object.values(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = path?.[method]
      if (operation?.security?.some((requirement) => 'DPoP' in requirement)) {
        operation.security = [{ DPoP: [] }, { ScopeCatalog: ['wallet:x402:pay'] }]
      }
    }
  }
  return document
}

function openApiRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw badRequest('Request validation failed.')
    },
  })
}

function handleError(error: Error, c: Context<AppEnv>) {
  if (error instanceof ApiError) {
    for (const [name, value] of new Headers(error.headers)) c.header(name, value)
    return c.json({ error: error.code, message: error.message }, error.status)
  }
  console.error(
    JSON.stringify({
      message: 'request failed',
      requestId: c.get('requestId'),
      path: new URL(c.req.url).pathname,
      error: error.message,
    }),
  )
  return c.json({ error: 'internal_error', message: 'The request failed.' }, 500)
}

function selectRequirement(paymentRequired: PaymentRequired, env: Env) {
  const supportedAsset = walletAsset(env)
  const accepted = paymentRequired.accepts.find(
    (candidate) =>
      candidate.scheme === 'exact' &&
      candidate.network === env.WALLET_NETWORK &&
      candidate.asset.toLowerCase() === supportedAsset.address.toLowerCase(),
  )
  if (!accepted) {
    throw badRequest(
      `No supported exact ${supportedAsset.symbol} payment requirement for ${env.WALLET_NETWORK}.`,
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
    'OIDC_ISSUER',
    'OIDC_CLIENT_ID',
    'OIDC_AUDIENCE',
    'WALLET_NETWORK',
  ]
  return env.SIGNER_MODE === 'mock'
    ? [...common, 'MOCK_SIGNER_PRIVATE_KEY']
    : [
        ...common,
        'WALLET_RPC_URL',
        'CDP_PROJECT_ID',
        'CDP_API_KEY_ID',
        'CDP_API_KEY_SECRET',
        'CDP_WALLET_SECRET',
      ]
}
