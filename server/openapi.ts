export function walletOpenApi(appOrigin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Agent Wallet API',
      version: '1.0.0',
      description:
        'An x402 payer for delegated Agents. When any business API returns HTTP 402 with PaymentRequired, call createX402Payment with that payload. A 202 response means the controller must approve a budget; open approvalUrl, poll getBudgetRequest until approved, then retry createX402Payment.',
    },
    servers: [{ url: `${appOrigin}/api` }],
    'x-x402': {
      role: 'payer',
      paymentOperationId: 'createX402Payment',
      trigger: 'HTTP 402 Payment Required',
    },
    paths: {
      '/x402/payments': {
        post: {
          operationId: 'createX402Payment',
          summary: 'Create an x402 payment for a PaymentRequired response',
          description:
            'Pass the unmodified x402 PaymentRequired object returned by a business API. On 200, encode paymentPayload as base64url JSON in PAYMENT-SIGNATURE and retry the original business request. On 202, open approvalUrl for the controller, poll getBudgetRequest using id, and retry this operation after approval.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentRequired' },
              },
            },
          },
          responses: {
            '200': {
              description: 'The signed x402 payment is ready for the original business request.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['paymentId', 'paymentPayload'],
                    properties: {
                      paymentId: { type: 'string' },
                      paymentPayload: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
            '202': {
              description:
                'Controller approval is required. Open approvalUrl, poll getBudgetRequest, then retry createX402Payment.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BudgetRequest' },
                },
              },
            },
          },
        },
      },
      '/agent/budget-requests/{id}': {
        get: {
          operationId: 'getBudgetRequest',
          summary: 'Read an Agent budget approval request',
          description:
            'Poll at the returned interval until status is approved, denied, or expired. Retry createX402Payment only after approval.',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'Current budget approval state.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/BudgetRequest' },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        PaymentRequired: {
          type: 'object',
          required: ['x402Version', 'resource', 'accepts'],
          properties: {
            x402Version: { type: 'integer', minimum: 1 },
            resource: {
              type: 'object',
              required: ['url'],
              properties: {
                url: { type: 'string', format: 'uri' },
                description: { type: 'string' },
                mimeType: { type: 'string' },
              },
            },
            accepts: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['scheme', 'network', 'asset', 'amount', 'payTo', 'maxTimeoutSeconds', 'extra'],
                properties: {
                  scheme: { type: 'string' },
                  network: { type: 'string' },
                  asset: { type: 'string' },
                  amount: { type: 'string' },
                  payTo: { type: 'string' },
                  maxTimeoutSeconds: { type: 'integer', minimum: 1 },
                  extra: { type: 'object', additionalProperties: true },
                },
              },
            },
            extensions: { type: 'object', additionalProperties: true },
          },
        },
        BudgetRequest: {
          type: 'object',
          required: ['id', 'status', 'expiresAt', 'grantId'],
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'approved', 'denied', 'expired'] },
            expiresAt: { type: 'string', format: 'date-time' },
            grantId: { type: ['string', 'null'] },
            approvalUrl: { type: 'string', format: 'uri' },
            interval: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
  }
}
