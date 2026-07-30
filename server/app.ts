import {
  budgetDecisionSchema,
  createBudgetRequestSchema,
  inspectBudgetRequestSchema,
  paymentRequiredSchema,
  updateWalletSchema,
  type PaymentRequired,
} from '../shared/contracts'
import { authenticateAgent, authenticateHuman, parseJson } from './auth'
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
import { createX402Payment } from './signer'
import { walletOpenApi } from './openapi'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

export function createApp() {
  const app = new Hono<{ Bindings: Env }>()

  app.use('/api', async (c, next) => {
    c.header(
      'Link',
      `<${c.env.APP_ORIGIN}/api/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
    )
    await next()
  })

  app.use('/api/*', async (c, next) => {
    c.header(
      'Link',
      `<${c.env.APP_ORIGIN}/api/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"`,
    )
    return cors({
      origin: c.env.APP_ORIGIN,
      allowHeaders: ['Authorization', 'Content-Type', 'DPoP'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: ['PAYMENT-SIGNATURE'],
      maxAge: 86400,
    })(c, next)
  })

  app.get('/healthz', (c) =>
    c.json({
      status: 'ok',
      network: c.env.WALLET_NETWORK,
      signer: c.env.SIGNER_MODE,
    }),
  )

  app.get('/api/config', (c) =>
    c.json({
      appOrigin: c.env.APP_ORIGIN,
      oidcIssuer: c.env.OIDC_ISSUER,
      clientId: c.env.OIDC_CLIENT_ID,
      audience: c.env.OIDC_AUDIENCE,
      agentIssuer: c.env.OIDC_ISSUER,
      network: c.env.WALLET_NETWORK,
      cdpProjectId: c.env.CDP_PROJECT_ID ?? null,
    }),
  )

  app.get('/api', (c) => c.json(walletOpenApi(c.env.APP_ORIGIN)))

  app.get('/api/openapi.json', (c) => {
    c.header('Content-Type', 'application/vnd.oai.openapi+json')
    return c.json(walletOpenApi(c.env.APP_ORIGIN))
  })

  app.get('/api/overview', async (c) => {
    const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:read')
    const user = await getOrCreateUser(c.env.DB, principal)
    return c.json(await overview(c.env.DB, user))
  })

  app.put('/api/wallet', async (c) => {
    const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
    const user = await getOrCreateUser(c.env.DB, principal)
    const input = parseJson(await c.req.json(), updateWalletSchema)
    await updateWallet(c.env.DB, user.id, input)
    return c.body(null, 204)
  })

  app.post('/api/agent/budget-requests', async (c) => {
    const principal = await authenticateAgent(c.req.raw, c.env)
    const input = parseJson(await c.req.json(), createBudgetRequestSchema)
    const result = await createBudgetRequest(c.env.DB, principal, c.env.APP_ORIGIN, input.name)
    return c.json(result, result.status === 'pending' ? 201 : 200)
  })

  app.get('/api/agent/budget-requests/:id', async (c) => {
    const principal = await authenticateAgent(c.req.raw, c.env)
    return c.json(await getBudgetRequestForAgent(c.env.DB, c.req.param('id'), principal))
  })

  app.post('/api/budget-requests/:id/inspect', async (c) => {
    const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
    const input = parseJson(await c.req.json(), inspectBudgetRequestSchema)
    return c.json(await getBudgetRequestForApproval(c.env.DB, c.req.param('id'), input.approvalToken, principal))
  })

  app.put('/api/budget-requests/:id/decision', async (c) => {
    const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
    const input = parseJson(await c.req.json(), budgetDecisionSchema)
    return c.json(await decideBudgetRequest(c.env.DB, c.req.param('id'), principal, input))
  })

  app.delete('/api/grants/:id', async (c) => {
    const principal = await authenticateHuman(c.req.raw, c.env, 'wallet:manage')
    const user = await getOrCreateUser(c.env.DB, principal)
    await revokeGrant(c.env.DB, user.id, c.req.param('id'))
    return c.body(null, 204)
  })

  app.post('/api/x402/payments', async (c) => {
    const principal = await authenticateAgent(c.req.raw, c.env)
    const paymentRequired = parseJson(await c.req.json(), paymentRequiredSchema)
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
      return c.json({ paymentId: reservation.paymentId, paymentPayload: payload })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Wallet signing failed.'
      await failPayment(c.env.DB, reservation.paymentId, reservation.grantId, accepted.amount, message)
      throw error
    }
  })

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      for (const [name, value] of new Headers(error.headers)) c.header(name, value)
      return c.json({ error: error.code, message: error.message }, error.status as 400)
    }
    console.error(
      JSON.stringify({
        message: 'request failed',
        path: new URL(c.req.url).pathname,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return c.json({ error: 'internal_error', message: 'The request failed.' }, 500)
  })

  return app
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
