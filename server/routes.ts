import {
  apiErrorSchema,
  budgetRequestStateSchema,
  createBudgetRequestSchema,
  paymentRequiredSchema,
  paymentResultSchema,
  settlementResponseSchema,
  settlementResultSchema,
} from '../shared/contracts'
import { createRoute, z } from '@hono/zod-openapi'

const json = <T extends z.ZodType>(schema: T) => ({
  'application/json': { schema },
})

const errorResponses = {
  400: {
    description: 'The request is invalid.',
    content: json(apiErrorSchema),
  },
  401: {
    description: 'Authentication failed.',
    content: json(apiErrorSchema),
  },
  403: {
    description: 'The principal is not authorized.',
    content: json(apiErrorSchema),
  },
  404: {
    description: 'The resource was not found.',
    content: json(apiErrorSchema),
  },
  409: {
    description: 'The request conflicts with current state.',
    content: json(apiErrorSchema),
  },
  502: {
    description: 'An upstream wallet or network service failed.',
    content: json(apiErrorSchema),
  },
  500: {
    description: 'The request failed.',
    content: json(apiErrorSchema),
  },
} as const

const idParamsSchema = z.object({
  id: z.string().min(1).openapi({
    param: { name: 'id', in: 'path' },
  }),
})

const idempotencyHeadersSchema = z.object({
  'idempotency-key': z.string().trim().min(8).max(200).openapi({
    param: { name: 'idempotency-key', in: 'header' },
    example: 'business-request-019fab92',
  }),
})

export const createBudgetRequestRoute = createRoute({
  method: 'post',
  path: '/agent/budget-requests',
  operationId: 'createBudgetRequest',
  tags: ['Agent'],
  security: [{ DPoP: [] }],
  summary: 'Request a spending budget for the current Agent',
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
      description: 'Controller approval is required.',
      content: json(budgetRequestStateSchema),
    },
    ...errorResponses,
  },
})

export const reportSettlementRoute = createRoute({
  method: 'post',
  path: '/x402/payments/{id}/settlement',
  operationId: 'reportX402Settlement',
  tags: ['Agent'],
  security: [{ DPoP: [] }],
  summary: 'Record and verify the merchant x402 settlement response',
  description:
    'After retrying the business request, decode its PAYMENT-RESPONSE header with the x402 standard Base64 HTTP decoder and submit the resulting SettleResponse here. Successful responses are verified against the Base Sepolia transaction before the payment is marked settled.',
  request: {
    params: idParamsSchema,
    body: {
      required: true,
      content: json(settlementResponseSchema),
    },
  },
  responses: {
    200: {
      description: 'The settlement result was recorded.',
      content: json(settlementResultSchema),
    },
    ...errorResponses,
  },
})

export const getBudgetRequestRoute = createRoute({
  method: 'get',
  path: '/agent/budget-requests/{id}',
  operationId: 'getBudgetRequest',
  tags: ['Agent'],
  security: [{ DPoP: [] }],
  summary: 'Read an Agent budget approval request',
  description:
    'Poll at the returned interval until status is approved, denied, or expired. Retry createX402Payment only after approval.',
  request: {
    params: idParamsSchema,
  },
  responses: {
    200: {
      description: 'Current budget approval state.',
      content: json(budgetRequestStateSchema),
    },
    ...errorResponses,
  },
})

export const createX402PaymentRoute = createRoute({
  method: 'post',
  path: '/x402/payments',
  operationId: 'createX402Payment',
  tags: ['Agent'],
  security: [{ DPoP: [] }],
  summary: 'Create an x402 payment for a PaymentRequired response',
  description:
    'Pass the unmodified x402 PaymentRequired object returned by a business API. On 200, encode paymentPayload with the x402 standard Base64 HTTP encoder in PAYMENT-SIGNATURE and retry the original business request. On 202, open approvalUrl for the controller, poll getBudgetRequest using id, and retry this operation after approval.',
  request: {
    headers: idempotencyHeadersSchema,
    body: {
      required: true,
      content: json(paymentRequiredSchema),
    },
  },
  responses: {
    200: {
      description: 'The signed x402 payment is ready for the original business request.',
      content: json(paymentResultSchema),
    },
    202: {
      description:
        'Controller approval is required. Open approvalUrl, poll getBudgetRequest, then retry createX402Payment.',
      content: json(budgetRequestStateSchema),
    },
    ...errorResponses,
  },
})
