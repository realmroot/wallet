import {
  apiErrorSchema,
  budgetRequestStateSchema,
  createBudgetRequestSchema,
  paymentRequiredSchema,
  paymentResultSchema,
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

export const createBudgetRequestRoute = createRoute({
  method: 'post',
  path: '/agent/budget-requests',
  operationId: 'createBudgetRequest',
  tags: ['Agent'],
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

export const getBudgetRequestRoute = createRoute({
  method: 'get',
  path: '/agent/budget-requests/{id}',
  operationId: 'getBudgetRequest',
  tags: ['Agent'],
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
  summary: 'Create an x402 payment for a PaymentRequired response',
  description:
    'Pass the unmodified x402 PaymentRequired object returned by a business API. On 200, encode paymentPayload as base64url JSON in PAYMENT-SIGNATURE and retry the original business request. On 202, open approvalUrl for the controller, poll getBudgetRequest using id, and retry this operation after approval.',
  request: {
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
