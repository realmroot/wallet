import { createServer } from 'node:http'
import { getDefaultAsset } from '@x402/evm'
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import { verifyTypedData } from 'viem'

const port = Number(process.env.PORT ?? 8788)
const amount = process.env.PRICE_ATOMIC ?? '25000'
const payTo = process.env.PAY_TO ?? '0x0000000000000000000000000000000000000001'
const network = 'eip155:84532'
const asset = getDefaultAsset(network)

const server = createServer(async (request, response) => {
  const origin = `http://${request.headers.host}`
  const resourceUrl = `${origin}/paid`
  if (request.method !== 'GET' || request.url !== '/paid') {
    return json(response, 404, { error: 'not_found' })
  }

  const required = paymentRequired(resourceUrl)
  const encodedPayment = request.headers['payment-signature']
  if (!encodedPayment) {
    response.setHeader('payment-required', encodePaymentRequiredHeader(required))
    return json(response, 402, required)
  }

  try {
    const payment = decodePaymentSignatureHeader(encodedPayment)
    await verifyPayment(payment, required)
    response.setHeader(
      'payment-response',
      encodePaymentResponseHeader({
        success: true,
        network,
        payer: payment.payload.authorization.from,
        amount,
        transaction: `0x${'ab'.repeat(32)}`,
      }),
    )
    return json(response, 200, {
      paid: true,
      message: 'The local x402 round trip succeeded.',
      settlement: 'This demo verifies the signature but does not broadcast a transaction.',
    })
  } catch (error) {
    response.setHeader('payment-required', encodePaymentRequiredHeader(required))
    return json(response, 402, {
      error: 'invalid_payment',
      message: error instanceof Error ? error.message : String(error),
    })
  }
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Fake paid service: http://localhost:${port}/paid\n`)
})

function paymentRequired(resourceUrl) {
  return {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: 'Local signature-verification demo',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network,
        asset: asset.address,
        amount,
        payTo,
        maxTimeoutSeconds: 300,
        extra: { name: asset.name, version: asset.version },
      },
    ],
  }
}

async function verifyPayment(payment, required) {
  const accepted = required.accepts[0]
  if (
    payment?.x402Version !== required.x402Version ||
    payment?.accepted?.network !== accepted.network ||
    payment?.accepted?.asset?.toLowerCase() !== accepted.asset.toLowerCase() ||
    payment?.accepted?.amount !== accepted.amount ||
    payment?.accepted?.payTo?.toLowerCase() !== accepted.payTo.toLowerCase()
  ) {
    throw new Error('Payment requirement mismatch.')
  }

  const authorization = payment.payload?.authorization
  if (
    authorization?.to?.toLowerCase() !== accepted.payTo.toLowerCase() ||
    authorization?.value !== accepted.amount
  ) {
    throw new Error('Payment authorization mismatch.')
  }

  const valid = await verifyTypedData({
    address: authorization.from,
    domain: {
      name: accepted.extra.name,
      version: accepted.extra.version,
      chainId: 84532,
      verifyingContract: accepted.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'TransferWithAuthorization',
    message: authorization,
    signature: payment.payload.signature,
  })
  if (!valid) throw new Error('EIP-712 payment signature is invalid.')
}

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(`${JSON.stringify(value)}\n`)
}
