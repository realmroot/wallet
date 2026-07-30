import { serve } from '@hono/node-server'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { paymentMiddleware } from '@x402/hono'
import { Hono } from 'hono'

const port = Number(process.env.PORT ?? 8789)
const payTo = process.env.PAY_TO
if (!payTo?.match(/^0x[0-9a-fA-F]{40}$/)) {
  throw new Error('PAY_TO must be a Base Sepolia EVM address.')
}

const facilitator = new HTTPFacilitatorClient({
  url: process.env.X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
})
const resourceServer = new x402ResourceServer(facilitator).register(
  'eip155:84532',
  new ExactEvmScheme(),
)
const app = new Hono()

app.use(
  paymentMiddleware(
    {
      'GET /paid': {
        accepts: {
          scheme: 'exact',
          price: process.env.PRICE_USD ?? '$0.01',
          network: 'eip155:84532',
          payTo,
        },
        description: 'Agent Wallet Base Sepolia settlement test',
        mimeType: 'application/json',
      },
    },
    resourceServer,
  ),
)

app.get('/paid', (c) =>
  c.json({
    paid: true,
    message: 'The facilitator verified and settled this x402 payment on Base Sepolia.',
  }),
)

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
  process.stdout.write(`Settling paid service: http://localhost:${port}/paid\n`)
})
