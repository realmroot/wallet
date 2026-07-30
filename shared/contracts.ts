import { z } from '@hono/zod-openapi'

const atomicAmount = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .openapi({ description: 'Atomic USDC amount.', example: '25000' })
const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .openapi({ example: '0x0000000000000000000000000000000000000001' })
const merchantOrigin = z
  .url()
  .refine((value) => new URL(value).origin === value, 'Merchant entries must be URL origins without paths.')
  .openapi({ example: 'https://api.example.com' })
const resourceId = z
  .uuid()
  .openapi({ description: 'Stable resource identifier.', example: '019c12e0-f8e0-7b71-87fd-43a523f07bd4' })
const usedAtomicAmount = z
  .string()
  .regex(/^\d{1,15}$/)
  .openapi({ description: 'Atomic USDC amount, including zero.', example: '25000' })
const networkId = z
  .string()
  .regex(/^[a-z0-9]+:[A-Za-z0-9._-]+$/)
  .openapi({ description: 'CAIP-2 network identifier.', example: 'eip155:84532' })

export const paymentRequiredSchema = z
  .object({
    x402Version: z.number().int().positive(),
    resource: z.object({
      url: z.url(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
    }),
    accepts: z
      .array(
        z.object({
          scheme: z.string(),
          network: z
            .string()
            .regex(/^[a-z0-9]+:[A-Za-z0-9._-]+$/)
            .transform((value) => value as `${string}:${string}`),
          asset: z.string(),
          amount: atomicAmount,
          payTo: evmAddress,
          maxTimeoutSeconds: z.number().int().positive(),
          extra: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('PaymentRequired')

export const createBudgetRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
  })
  .openapi('CreateBudgetRequest')

export const inspectBudgetRequestSchema = z
  .object({
    approvalToken: z.string().min(32).max(255),
  })
  .openapi('InspectBudgetRequest')

const budgetPolicy = z
  .object({
    name: z.string().trim().min(1).max(100),
    totalLimit: atomicAmount,
    perTransactionLimit: atomicAmount,
    periodKind: z.enum(['none', 'daily', 'monthly']),
    periodLimit: atomicAmount.nullable(),
    allowedOrigins: z.array(merchantOrigin).max(20).default([]),
    allowedRecipients: z.array(evmAddress).max(20).default([]),
    expiresAt: z.iso.datetime().nullable(),
  })
  .openapi('BudgetPolicy')

export const budgetDecisionSchema = z
  .discriminatedUnion('decision', [
    z.object({
      decision: z.literal('deny'),
      approvalToken: z.string().min(32).max(255),
    }),
    budgetPolicy.extend({
      decision: z.literal('approve'),
      approvalToken: z.string().min(32).max(255),
    }),
  ])
  .openapi('BudgetDecision')

export const updateWalletSchema = z
  .object({
    cdpUserId: z.string().trim().min(1).max(100),
    address: evmAddress,
  })
  .openapi('UpdateWallet')

export type PaymentRequired = z.infer<typeof paymentRequiredSchema>
export type BudgetDecisionInput = z.infer<typeof budgetDecisionSchema>
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>

export const budgetRequestStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired'])
export type BudgetRequestStatus = z.infer<typeof budgetRequestStatusSchema>

export const budgetRequestStateSchema = z
  .object({
    requestId: resourceId
      .nullable()
      .openapi({ description: 'Budget request identifier, or null when an active budget already exists.' }),
    budgetId: resourceId
      .nullable()
      .openapi({ description: 'Approved budget identifier, or null while no budget has been approved.' }),
    status: budgetRequestStatusSchema,
    expiresAt: z.iso.datetime(),
    approvalUrl: z.url().optional(),
    pollIntervalSeconds: z
      .number()
      .int()
      .positive()
      .openapi({ description: 'Recommended polling interval in seconds.', example: 3 })
      .optional(),
  })
  .openapi('BudgetRequest')
export type BudgetRequestState = z.infer<typeof budgetRequestStateSchema>

export const budgetRequestDetailSchema = budgetRequestStateSchema
  .extend({
    agentIssuer: z.string(),
    agentSubject: z.string(),
    requestedName: z.string().nullable(),
  })
  .openapi('BudgetRequestDetail')
export type BudgetRequestDetail = z.infer<typeof budgetRequestDetailSchema>

export const budgetDecisionResultSchema = z
  .object({
    status: z.enum(['approved', 'denied']),
    grantId: z.string().nullable(),
  })
  .openapi('BudgetDecisionResult')

export const walletUserSchema = z
  .object({
    id: z.string(),
    issuer: z.string(),
    subject: z.string(),
    email: z.string().nullable(),
    cdpUserId: z.string().nullable(),
    walletAddress: evmAddress.nullable(),
    delegationExpiresAt: z.iso.datetime().nullable(),
    pausedAt: z.iso.datetime().nullable(),
  })
  .openapi('WalletUser')
export type WalletUser = z.infer<typeof walletUserSchema>

export const agentGrantSchema = z
  .object({
    id: z.string(),
    agentIssuer: z.string(),
    agentSubject: z.string(),
    name: z.string(),
    totalLimit: atomicAmount,
    spentTotal: z.string().regex(/^\d{1,15}$/),
    perTransactionLimit: atomicAmount,
    periodKind: z.enum(['none', 'daily', 'monthly']),
    periodLimit: atomicAmount.nullable(),
    periodSpent: z.string().regex(/^\d{1,15}$/),
    allowedOrigins: z.array(merchantOrigin),
    allowedRecipients: z.array(evmAddress),
    expiresAt: z.iso.datetime().nullable(),
    pausedAt: z.iso.datetime().nullable(),
    revokedAt: z.iso.datetime().nullable(),
  })
  .openapi('AgentGrant')
export type AgentGrant = z.infer<typeof agentGrantSchema>

export const agentWalletBlockerSchema = z.enum([
  'wallet_not_provisioned',
  'wallet_paused',
  'delegation_inactive',
  'budget_not_granted',
  'budget_paused',
  'budget_expired',
  'funding_unavailable',
  'insufficient_funds',
  'total_limit_reached',
  'period_limit_reached',
])
export type AgentWalletBlocker = z.infer<typeof agentWalletBlockerSchema>

export const agentWalletSchema = z
  .object({
    network: networkId,
    asset: z.object({
      symbol: z.string().openapi({ example: 'USDC' }),
      contractAddress: evmAddress,
      decimals: z.number().int().nonnegative().openapi({ example: 6 }),
    }),
    delegation: z.object({
      status: z.enum(['active', 'inactive']),
      expiresAt: z.iso.datetime().nullable(),
    }),
    budget: z
      .object({
        id: resourceId,
        name: z.string().openapi({ example: 'Build Agent' }),
        status: z.enum(['active', 'paused', 'expired']),
        limits: z.object({
          total: atomicAmount,
          perPayment: atomicAmount,
          period: z.object({
            kind: z.enum(['none', 'daily', 'monthly']),
            amount: atomicAmount.nullable(),
          }),
        }),
        usage: z.object({
          total: usedAtomicAmount,
          period: usedAtomicAmount,
        }),
        remaining: z.object({
          total: usedAtomicAmount,
          period: usedAtomicAmount.nullable(),
        }),
        restrictions: z.object({
          merchantOrigins: z.array(merchantOrigin),
          recipients: z.array(evmAddress),
        }),
        expiresAt: z.iso.datetime().nullable(),
      })
      .nullable(),
    payment: z.object({
      ready: z.boolean(),
      maximumAmount: usedAtomicAmount
        .nullable()
        .openapi({ description: 'Maximum currently payable atomic USDC amount, or null when unavailable.' }),
      blockers: z.array(agentWalletBlockerSchema),
    }),
  })
  .openapi('AgentWallet')
export type AgentWallet = z.infer<typeof agentWalletSchema>

export const updateGrantSchema = budgetPolicy.openapi('UpdateGrant')
export type UpdateGrantInput = z.infer<typeof updateGrantSchema>

export const grantActionSchema = z
  .object({
    action: z.enum(['pause', 'resume']),
  })
  .openapi('GrantAction')
export type GrantActionInput = z.infer<typeof grantActionSchema>

export const walletActionSchema = z.object({
  action: z.enum(['pause', 'resume']),
})
export type WalletActionInput = z.infer<typeof walletActionSchema>

export const paymentSummarySchema = z
  .object({
    id: z.string(),
    amount: atomicAmount,
    payTo: evmAddress,
    resource: z.url(),
    status: z.enum(['reserved', 'signed', 'settled', 'failed']),
    transactionHash: z.string().nullable(),
    error: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi('PaymentSummary')

export const walletBalanceSchema = z
  .object({
    symbol: z.string(),
    amount: z.string().regex(/^\d+$/),
    decimals: z.number().int().nonnegative(),
    contractAddress: evmAddress.nullable(),
  })
  .openapi('WalletBalance')

export const walletRuntimeSchema = z
  .object({
    balances: z.array(walletBalanceSchema),
    balanceStatus: z.enum(['available', 'unavailable']),
    faucetAvailable: z.boolean(),
  })
  .openapi('WalletRuntime')
export type WalletRuntime = z.infer<typeof walletRuntimeSchema>

export const auditEventSchema = z
  .object({
    id: z.string(),
    actorKind: z.enum(['human', 'agent', 'system']),
    actorSubject: z.string(),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi('AuditEvent')

export const walletOverviewSchema = z
  .object({
    user: walletUserSchema,
    grants: z.array(agentGrantSchema),
    payments: z.array(paymentSummarySchema),
    auditEvents: z.array(auditEventSchema),
    runtime: walletRuntimeSchema,
  })
  .openapi('WalletOverview')
export type WalletOverview = z.infer<typeof walletOverviewSchema>

export const paymentResultSchema = z
  .object({
    paymentId: resourceId,
    paymentPayload: z.record(z.string(), z.unknown()),
    replayed: z.boolean(),
  })
  .openapi('PaymentResult')

export const settlementResponseSchema = z
  .object({
    success: z.boolean(),
    errorReason: z.string().optional(),
    errorMessage: z.string().optional(),
    payer: evmAddress.optional(),
    transaction: z.string().min(1),
    network: z.string(),
    amount: z.string().regex(/^\d+$/).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('SettlementResponse')
export type SettlementResponse = z.infer<typeof settlementResponseSchema>

export const settlementResultSchema = z
  .object({
    paymentId: resourceId,
    status: z.enum(['signed', 'settled']),
    transactionHash: z.string().nullable(),
  })
  .openapi('SettlementResult')

export const faucetRequestSchema = z.object({
  token: z.enum(['usdc', 'eth']),
})
export type FaucetRequest = z.infer<typeof faucetRequestSchema>

export const faucetResultSchema = z.object({
  transactionHash: z.string(),
})

export const apiErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .openapi('ApiError')
