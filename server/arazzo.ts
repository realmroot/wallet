export const ARAZZO_DOCUMENT_PATH = '/workflows.arazzo.json'
export const ARAZZO_MEDIA_TYPE = 'application/vnd.oai.workflows+json; version=1.1.0'

export function createArazzoDocument(origin: string) {
  return {
    arazzo: '1.1.0',
    $self: `${origin}${ARAZZO_DOCUMENT_PATH}`,
    info: {
      title: 'x402 payer workflows',
      summary: 'Machine-readable workflows for authorizing and confirming x402 payments',
      description:
        'These workflows accept standard x402 headers as opaque values. The caller remains responsible for invoking the paid resource operation and passing its response headers unchanged.',
      version: '1.0.0',
    },
    sourceDescriptions: [
      {
        name: 'payer',
        url: './openapi.json',
        type: 'openapi',
      },
    ],
    workflows: [
      {
        workflowId: 'authorizeX402Payment',
        summary: 'Authorize an x402 payment',
        description:
          'Pass a fresh PAYMENT-REQUIRED header unchanged. A 200 response returns PAYMENT-SIGNATURE for the original resource request. If the operation returns 422, select one advertised selectionId and retry with paymentSelection and the same idempotencyKey. If it returns 202, complete the advertised approval interaction and retry.',
        inputs: {
          type: 'object',
          properties: {
            paymentRequired: { type: 'string', minLength: 1 },
            idempotencyKey: { type: 'string', minLength: 1 },
          },
          required: ['paymentRequired', 'idempotencyKey'],
        },
        steps: [
          {
            stepId: 'authorizePayment',
            operationId: 'createPaymentAuthorization',
            parameters: [
              { name: 'payment-required', in: 'header', value: '$inputs.paymentRequired' },
              { name: 'idempotency-key', in: 'header', value: '$inputs.idempotencyKey' },
            ],
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: {
              paymentId: '$response.body#/paymentId',
              paymentSignature: '$response.header.PAYMENT-SIGNATURE',
            },
          },
        ],
        outputs: {
          paymentId: '$steps.authorizePayment.outputs.paymentId',
          paymentSignature: '$steps.authorizePayment.outputs.paymentSignature',
        },
      },
      {
        workflowId: 'authorizeSelectedX402Payment',
        summary: 'Authorize a selected x402 payment option',
        description:
          'After authorizeX402Payment returns 422 with multiple compatible options, choose one advertised selectionId and retry the same requirement with the same idempotency key.',
        inputs: {
          type: 'object',
          properties: {
            paymentRequired: { type: 'string', minLength: 1 },
            idempotencyKey: { type: 'string', minLength: 1 },
            paymentSelection: { type: 'string', minLength: 1 },
          },
          required: ['paymentRequired', 'idempotencyKey', 'paymentSelection'],
        },
        steps: [
          {
            stepId: 'authorizeSelectedPayment',
            operationId: 'createPaymentAuthorization',
            parameters: [
              { name: 'payment-required', in: 'header', value: '$inputs.paymentRequired' },
              { name: 'idempotency-key', in: 'header', value: '$inputs.idempotencyKey' },
              { name: 'payment-selection', in: 'header', value: '$inputs.paymentSelection' },
            ],
            successCriteria: [{ condition: '$statusCode == 200' }],
            outputs: {
              paymentId: '$response.body#/paymentId',
              paymentSignature: '$response.header.PAYMENT-SIGNATURE',
            },
          },
        ],
        outputs: {
          paymentId: '$steps.authorizeSelectedPayment.outputs.paymentId',
          paymentSignature: '$steps.authorizeSelectedPayment.outputs.paymentSignature',
        },
      },
      {
        workflowId: 'confirmX402Payment',
        summary: 'Confirm an x402 payment',
        description:
          'After the paid resource succeeds, pass its PAYMENT-RESPONSE header unchanged. If confirmation returns 425, wait for Retry-After and repeat this idempotent confirmation step. The confirmation is verified before the payment is read back and required to be settled.',
        inputs: {
          type: 'object',
          properties: {
            paymentId: { type: 'string', minLength: 1 },
            paymentResponse: { type: 'string', minLength: 1 },
          },
          required: ['paymentId', 'paymentResponse'],
        },
        steps: [
          {
            stepId: 'confirmSettlement',
            operationId: 'confirmPaymentSettlement',
            parameters: [
              { name: 'paymentId', in: 'path', value: '$inputs.paymentId' },
              { name: 'payment-response', in: 'header', value: '$inputs.paymentResponse' },
            ],
            successCriteria: [{ condition: '$statusCode == 200' }],
          },
          {
            stepId: 'readPayment',
            operationId: 'getPayment',
            parameters: [{ name: 'paymentId', in: 'path', value: '$inputs.paymentId' }],
            successCriteria: [
              { condition: '$statusCode == 200' },
              { condition: '$response.body#/status == "settled"' },
            ],
            outputs: {
              payment: '$response.body',
            },
          },
        ],
        outputs: {
          payment: '$steps.readPayment.outputs.payment',
        },
      },
    ],
  } as const
}
