import {
  budgetDecisionSchema,
  inspectBudgetRequestSchema,
  type PaymentRequired,
  updateWalletSchema,
} from '../shared/contracts'
import { authenticateAgent, authenticateHuman } from './auth'
import { ApiError, badRequest } from './errors'
import {
  completePayment,
  createBudgetRequest,
  decideBudgetRequest,
  failPayment,
  getBudgetRequestForAgent,
  getBudgetRequestForApproval,
  getOrCreateUser,
  overview,
  reservePayment,
  revokeGrant,
  updateWallet,
} from './repository'
import {
  createBudgetRequestRoute,
  createX402PaymentRoute,
  getBudgetRequestRoute,
} from './routes'
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

  return app
    .get('/healthz', (c) =>
      c.json({
        status: 'ok',
        network: c.env.WALLET_NETWORK,
        signer: c.env.SIGNER_MODE,
      }),
    )
    .route('/api', createApi())
    .onError(handleError)
}

function createApi() {
  const api = new OpenAPIHono<AppEnv>()

  api.use('*', requestId())
  api.use('*', secureHeaders())
  api.use(
    '*',
    cors({
      origin: (origin, c) => (origin === c.env.APP_ORIGIN ? origin : undefined),
      allowHeaders: ['Authorization', 'Content-Type', 'DPoP'],
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
      `<${c.env.APP_ORIGIN}/api/openapi.json>; rel="service-desc"; type="application/openapi+json"`,
    )
    await next()
  })

  return api.route('/', createHumanApi()).route('/', createAgentApi()).onError(handleError)
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
    .get('/overview', async (c) => {
      const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:read')
      const user = await getOrCreateUser(c.env.DB, principal)
      return c.json(await overview(c.env.DB, user), 200)
    })
    .put(
      '/wallet',
      zValidator('json', updateWalletSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        const user = await getOrCreateUser(c.env.DB, principal)
        await updateWallet(c.env.DB, user.id, c.req.valid('json'))
        return c.body(null, 204)
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
      '/budget-requests/:id/decision',
      zValidator('param', idParamsSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      zValidator('json', budgetDecisionSchema, (result) => {
        if (!result.success) invalidRequest()
      }),
      async (c) => {
        const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
        return c.json(
          await decideBudgetRequest(c.env.DB, c.req.valid('param').id, principal, c.req.valid('json')),
          200,
        )
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
        await revokeGrant(c.env.DB, user.id, c.req.valid('param').id)
        return c.body(null, 204)
      },
    )
}

export type HumanApiType = ReturnType<typeof createHumanApi>

function createAgentApi() {
  const api = openApiRouter()

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
      const budget = await createBudgetRequest(c.env.DB, principal, c.env.APP_ORIGIN)
      if (budget.status !== 'approved') return c.json(budget, 202)

      const accepted = selectRequirement(paymentRequired, c.env.WALLET_NETWORK)
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
      })
      try {
        const payload = await createX402Payment(c.env, {
          cdpUserId: reservation.user.cdpUserId!,
          address: reservation.user.walletAddress as `0x${string}`,
          paymentRequired,
          idempotencyKey: reservation.paymentId,
        })
        await completePayment(c.env.DB, reservation.paymentId, payload)
        return c.json({ paymentId: reservation.paymentId, paymentPayload: payload }, 200)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Wallet signing failed.'
        await failPayment(c.env.DB, reservation.paymentId, reservation.grantId, accepted.amount, message)
        throw error
      }
    })

  const document = (origin: string) => ({
    openapi: '3.1.0',
    info: {
      title: 'Agent Wallet API',
      version: '1.0.0',
      description:
        'An x402 payer for delegated Agents. When any business API returns HTTP 402 with PaymentRequired, call createX402Payment with that payload. A 202 response means the controller must approve a budget; open approvalUrl, poll getBudgetRequest until approved, then retry createX402Payment.',
    },
    servers: [{ url: `${origin}/api` }],
    tags: [{ name: 'Agent', description: 'DPoP-bound operations used by Agents.' }],
    'x-x402': {
      role: 'payer',
      paymentOperationId: 'createX402Payment',
      trigger: 'HTTP 402 Payment Required',
    },
    'x-agent-auth': {
      scheme: 'DPoP',
      provider: 'FlareAuth',
      managedBy: 'Restish authentication adapter',
    },
  })
  return routes
    .doc31('/', (c) => document(c.env.APP_ORIGIN))
    .doc31('/openapi.json', (c) => document(c.env.APP_ORIGIN))
    .onError(handleError)
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

function selectRequirement(paymentRequired: PaymentRequired, network: string) {
  const accepted = paymentRequired.accepts.find(
    (candidate) => candidate.scheme === 'exact' && candidate.network === network,
  )
  if (!accepted) throw badRequest(`No supported exact payment requirement for ${network}.`)
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
