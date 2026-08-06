import {
  agentPaymentSchema,
  apiErrorSchema,
  agentWalletSchema,
  budgetRequestStateSchema,
  createBudgetRequestSchema,
  paymentRequiredSchema,
  paymentResultSchema,
  settlementResponseSchema,
  settlementResultSchema,
} from '../shared/contracts'
import { agentOperations } from './agent-policy'
import { createRoute, z } from '@hono/zod-openapi'

const json = <T extends z.ZodType>(schema: T) => ({
  'application/json': { schema },
})

const badRequestResponse = {
  400: {
    description: 'The request is invalid.',
    content: json(apiErrorSchema),
  },
} as const

const paymentAuthorizationBadRequestResponse = {
  400: {
    description:
      'The x402 requirement is invalid or its Solana recipient is not initialized on-chain.',
    content: json(apiErrorSchema),
  },
} as const

const authenticationResponses = {
  401: {
    description: 'Authentication failed.',
    headers: {
      'WWW-Authenticate': {
        description:
          'OAuth authentication challenge including the RFC 9728 protected resource metadata URL.',
        schema: { type: 'string' },
      },
    },
    content: json(apiErrorSchema),
  },
  403: {
    description: 'The principal is not authorized.',
    headers: {
      'WWW-Authenticate': {
        description:
          'OAuth insufficient-scope challenge including the RFC 9728 protected resource metadata URL when applicable.',
        schema: { type: 'string' },
      },
    },
    content: json(apiErrorSchema),
  },
} as const

const notFoundResponse = {
  404: {
    description: 'The resource was not found.',
    content: json(apiErrorSchema),
  },
} as const

const conflictResponse = {
  409: {
    description: 'The request conflicts with current state.',
    content: json(apiErrorSchema),
  },
} as const

const payloadTooLargeResponse = {
  413: {
    description: 'The request body exceeds 64 KiB.',
    content: json(apiErrorSchema),
  },
} as const

const upstreamResponse = {
  502: {
    description: 'An upstream wallet or network service failed.',
    content: json(apiErrorSchema),
  },
} as const

const internalErrorResponse = {
  500: {
    description: 'The request failed.',
    content: json(apiErrorSchema),
  },
} as const

const budgetRequestParamsSchema = z.object({
  requestId: z.uuid().openapi({
    param: { name: 'requestId', in: 'path' },
    description: 'Budget request identifier.',
    example: '019c12e0-f8e0-7b71-87fd-43a523f07bd4',
  }),
})

const paymentParamsSchema = z.object({
  paymentId: z.uuid().openapi({
    param: { name: 'paymentId', in: 'path' },
    description: 'Payment identifier.',
    example: '019c12e0-f8e0-7b71-87fd-43a523f07bd4',
  }),
})

const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8).max(200).openapi({
    param: { name: 'idempotency-key', in: 'header' },
    example: 'business-request-019fab92',
  }),
})

const paymentRequiredHeadersSchema = idempotencyHeadersSchema.extend({
  'payment-required': z.string().min(1).max(64 * 1024).optional().openapi({
    param: { name: 'payment-required', in: 'header' },
    description: 'Standard x402 Base64-encoded PaymentRequired object.',
  }),
})

const paymentResponseHeadersSchema = z.object({
  'payment-response': z.string().min(1).max(64 * 1024).optional().openapi({
    param: { name: 'payment-response', in: 'header' },
    description: 'Standard x402 Base64-encoded SettleResponse object.',
  }),
})

export const createBudgetRequestRoute = createRoute({
  method: 'post',
  path: '/agent/budget-requests',
  operationId: agentOperations.createBudgetRequest.operationId,
  tags: ['budget'],
  'x-cli-name': 'request',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Request a budget',
  description:
    'Requests a controller-approved spending budget for either Production mainnets or Sandbox testnets. The authenticated Agent identity is shared across both modes, while their budgets and counters are independent.',
  request: {
    body: {
      required: true,
      content: json(createBudgetRequestSchema),
    },
  },
  responses: {
    200: {
      description: 'An active budget already exists.',
      content: json(budgetRequestStateSchema),
    },
    201: {
      description: 'The budget request was created and requires controller approval.',
      headers: {
        Location: {
          description: 'URL of the created budget request.',
          schema: { type: 'string', format: 'uri' },
        },
        'Retry-After': {
          description: 'Recommended polling delay in seconds.',
          schema: { type: 'string', pattern: '^\\d+$' },
        },
      },
      content: json(budgetRequestStateSchema),
    },
    ...badRequestResponse,
    ...authenticationResponses,
    ...payloadTooLargeResponse,
    ...internalErrorResponse,
  },
})

export const getAgentWalletRoute = createRoute({
  method: 'get',
  path: '/agent/wallet',
  operationId: agentOperations.getWallet.operationId,
  tags: ['wallet'],
  'x-cli-name': 'show',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Show the current Agent wallet',
  description:
    'Returns the authenticated Agent’s Production and Sandbox budgets plus per-network restrictions, readiness, and maximum payable atomic USDC amount without exposing controller account data.',
  responses: {
    200: {
      description: 'The Wallet view delegated to the authenticated Agent.',
      content: json(agentWalletSchema),
    },
    ...authenticationResponses,
    ...upstreamResponse,
    ...internalErrorResponse,
  },
})

export const confirmPaymentSettlementRoute = createRoute({
  method: 'put',
  path: '/x402/payments/{paymentId}/settlement',
  operationId: agentOperations.confirmPaymentSettlement.operationId,
  tags: ['payment'],
  'x-cli-name': 'confirm',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Confirm a payment settlement',
  description:
    'After retrying the business request, forward its PAYMENT-RESPONSE header or submit the decoded SettleResponse as JSON. Successful responses are verified on the configured network before the payment is marked settled.',
  request: {
    params: paymentParamsSchema,
    headers: paymentResponseHeadersSchema,
    body: {
      required: false,
      content: json(settlementResponseSchema),
    },
  },
  responses: {
    200: {
      description: 'The settlement result was recorded.',
      content: json(settlementResultSchema),
    },
    ...badRequestResponse,
    ...authenticationResponses,
    ...notFoundResponse,
    ...conflictResponse,
    ...payloadTooLargeResponse,
    ...upstreamResponse,
    ...internalErrorResponse,
  },
})

export const getBudgetRequestRoute = createRoute({
  method: 'get',
  path: '/agent/budget-requests/{requestId}',
  operationId: agentOperations.getBudgetRequest.operationId,
  tags: ['budget'],
  'x-cli-name': 'status',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Show a budget request',
  description:
    'Poll at pollIntervalSeconds until status is approved, denied, or expired. Retry payment authorization only after approval.',
  request: {
    params: budgetRequestParamsSchema,
  },
  responses: {
    200: {
      description: 'Current budget approval state.',
      content: json(budgetRequestStateSchema),
    },
    ...badRequestResponse,
    ...authenticationResponses,
    ...notFoundResponse,
    ...internalErrorResponse,
  },
})

export const createPaymentAuthorizationRoute = createRoute({
  method: 'post',
  path: '/x402/payments',
  operationId: agentOperations.createPaymentAuthorization.operationId,
  tags: ['payment'],
  'x-cli-name': 'authorize',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Authorize an x402 payment',
  description:
    'Pass the unmodified x402 PaymentRequired object as either JSON or the standard PAYMENT-REQUIRED header. On 200, forward the returned PAYMENT-SIGNATURE header to the original business request. On 202, open approvalUrl for the controller, poll the budget request, and retry this operation after approval.',
  request: {
    headers: paymentRequiredHeadersSchema,
    body: {
      required: false,
      content: json(paymentRequiredSchema),
    },
  },
  responses: {
    200: {
      description: 'The signed x402 payment is ready for the original business request.',
      headers: {
        'PAYMENT-SIGNATURE': {
          description: 'Standard x402 Base64-encoded payment payload.',
          required: true,
          schema: { type: 'string' },
        },
      },
      content: json(paymentResultSchema),
    },
    202: {
      description:
        'Controller approval is required. Open approvalUrl, poll the budget request, then retry payment authorization.',
      headers: {
        Location: {
          description: 'URL of the budget request awaiting approval.',
          schema: { type: 'string', format: 'uri' },
        },
        'Retry-After': {
          description: 'Recommended polling delay in seconds.',
          schema: { type: 'string', pattern: '^\\d+$' },
        },
      },
      content: json(budgetRequestStateSchema),
    },
    ...paymentAuthorizationBadRequestResponse,
    ...authenticationResponses,
    ...conflictResponse,
    ...payloadTooLargeResponse,
    ...upstreamResponse,
    ...internalErrorResponse,
  },
})

export const getPaymentRoute = createRoute({
  method: 'get',
  path: '/x402/payments/{paymentId}',
  operationId: agentOperations.getPayment.operationId,
  tags: ['payment'],
  'x-cli-name': 'status',
  security: [{ RealmrootOAuth: [] }],
  summary: 'Show an x402 payment',
  description:
    'Returns the current state of a payment created by the authenticated Agent without exposing signatures, authorization payloads, or controller data.',
  request: {
    params: paymentParamsSchema,
  },
  responses: {
    200: {
      description: 'Current payment state.',
      content: json(agentPaymentSchema),
    },
    ...badRequestResponse,
    ...authenticationResponses,
    ...notFoundResponse,
    ...internalErrorResponse,
  },
})
