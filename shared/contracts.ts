import { z } from '@hono/zod-openapi'

const atomicAmount = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .openapi({ description: 'Atomic USDC amount.', example: '25000' })
const usedAtomicAmount = z
  .string()
  .regex(/^\d{1,15}$/)
  .openapi({ description: 'Atomic USDC amount, including zero.', example: '25000' })
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const solanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
const walletAddress = z
  .union([evmAddress, solanaAddress])
  .openapi({ example: '0x0000000000000000000000000000000000000001' })
const merchantOrigin = z
  .url()
  .refine((value) => new URL(value).origin === value, 'Merchant entries must be URL origins without paths.')
  .openapi({ example: 'https://api.example.com' })
const resourceId = z
  .uuid()
  .openapi({ description: 'Stable resource identifier.', example: '019c12e0-f8e0-7b71-87fd-43a523f07bd4' })
const networkId = z
  .string()
  .regex(/^[a-z0-9]+:[A-Za-z0-9._-]+$/)
  .openapi({ description: 'CAIP-2 network identifier.', example: 'eip155:84532' })
const accountFamily = z.enum(['evm', 'solana'])
export const walletModeSchema = z.enum(['production', 'sandbox'])
export type WalletMode = z.infer<typeof walletModeSchema>
const printableAscii = /^[\x20-\x7e]+$/

const paymentOptionSchema = z.object({
  scheme: z.string(),
  network: networkId.transform((value) => value as `${string}:${string}`),
  asset: walletAddress,
  amount: atomicAmount,
  payTo: walletAddress.describe(
    'Merchant recipient. On Solana, this address must already exist on the selected network.',
  ),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
})

export const paymentRequiredSchema = z
  .object({
    x402Version: z.number().int().positive(),
    resource: z.object({
      url: z.url(),
      description: z
        .string()
        .nullish()
        .transform((value) => value ?? undefined)
        .optional(),
      mimeType: z
        .string()
        .nullish()
        .transform((value) => value ?? undefined)
        .optional(),
      serviceName: z
        .string()
        .min(1)
        .max(32)
        .regex(printableAscii)
        .nullish()
        .transform((value) => value ?? undefined)
        .optional(),
      tags: z
        .array(z.string().min(1).max(32).regex(printableAscii))
        .max(5)
        .nullish()
        .transform((value) => value ?? undefined)
        .optional(),
      iconUrl: z
        .string()
        .max(2048)
        .nullish()
        .transform((value) => value ?? undefined)
        .optional(),
    }),
    accepts: z.array(paymentOptionSchema).min(1),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('PaymentRequired')

export const createBudgetRequestSchema = z
  .object({
    mode: walletModeSchema,
  })
  .strict()
  .openapi('CreateBudgetRequest')

export const inspectBudgetRequestSchema = z
  .object({ approvalToken: z.string().min(32).max(255) })
  .openapi('InspectBudgetRequest')

const budgetPolicy = z
  .object({
    totalLimit: atomicAmount,
    perTransactionLimit: atomicAmount,
    periodKind: z.enum(['none', 'daily', 'monthly']),
    periodLimit: atomicAmount.nullable(),
    allowedOrigins: z.array(merchantOrigin).max(20).default([]),
    allowedRecipients: z.array(walletAddress).max(20).default([]),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict()
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

const walletAccountInputSchema = z.object({
  family: accountFamily,
  address: walletAddress,
})

export const updateWalletSchema = z
  .object({
    cdpUserId: z.string().trim().min(1).max(100),
    accounts: z.array(walletAccountInputSchema).min(1).max(2),
  })
  .refine(
    ({ accounts }) => new Set(accounts.map((account) => account.family)).size === accounts.length,
    'Only one account per family can be registered.',
  )
  .openapi('UpdateWallet')

export type PaymentRequired = z.infer<typeof paymentRequiredSchema>
export type BudgetDecisionInput = z.infer<typeof budgetDecisionSchema>
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>

export const budgetRequestStatusSchema = z.enum(['pending', 'approved', 'denied', 'expired'])
export type BudgetRequestStatus = z.infer<typeof budgetRequestStatusSchema>

export const budgetRequestStateSchema = z
  .object({
    requestId: resourceId.nullable(),
    budgetId: resourceId.nullable(),
    mode: walletModeSchema,
    status: budgetRequestStatusSchema,
    expiresAt: z.iso.datetime(),
    approvalUrl: z.url().optional(),
    pollIntervalSeconds: z.number().int().positive().optional(),
  })
  .openapi('BudgetRequest')
export type BudgetRequestState = z.infer<typeof budgetRequestStateSchema>

export const budgetRequestDetailSchema = budgetRequestStateSchema
  .extend({
    agentIssuer: z.string(),
    agentSubject: z.string(),
  })
  .openapi('BudgetRequestDetail')
export type BudgetRequestDetail = z.infer<typeof budgetRequestDetailSchema>

export const budgetDecisionResultSchema = z
  .object({
    status: z.enum(['approved', 'denied']),
    grantId: z.string().nullable(),
  })
  .openapi('BudgetDecisionResult')

export const walletAccountSchema = z
  .object({
    id: resourceId,
    family: accountFamily,
    address: walletAddress,
    delegationExpiresAt: z.iso.datetime().nullable(),
  })
  .openapi('WalletAccount')
export type WalletAccount = z.infer<typeof walletAccountSchema>

export const walletUserSchema = z
  .object({
    id: z.string(),
    issuer: z.string(),
    subject: z.string(),
    email: z.string().nullable(),
    cdpUserId: z.string().nullable(),
    accounts: z.array(walletAccountSchema),
    pausedAt: z.iso.datetime().nullable(),
  })
  .openapi('WalletUser')
export type WalletUser = z.infer<typeof walletUserSchema>

export const agentGrantSchema = z
  .object({
    id: z.string(),
    agentIssuer: z.string(),
    agentSubject: z.string(),
    mode: walletModeSchema,
    totalLimit: atomicAmount,
    spentTotal: usedAtomicAmount,
    perTransactionLimit: atomicAmount,
    periodKind: z.enum(['none', 'daily', 'monthly']),
    periodLimit: atomicAmount.nullable(),
    periodSpent: usedAtomicAmount,
    allowedOrigins: z.array(merchantOrigin),
    allowedRecipients: z.array(walletAddress),
    expiresAt: z.iso.datetime().nullable(),
    pausedAt: z.iso.datetime().nullable(),
  })
  .openapi('AgentGrant')
export type AgentGrant = z.infer<typeof agentGrantSchema>

export const agentWalletBlockerSchema = z.enum([
  'payments_disabled',
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

const agentBudgetSchema = z.object({
  id: resourceId,
  mode: walletModeSchema,
  status: z.enum(['active', 'paused', 'expired']),
  limits: z.object({
    total: atomicAmount,
    perPayment: atomicAmount,
    period: z.object({
      kind: z.enum(['none', 'daily', 'monthly']),
      amount: atomicAmount.nullable(),
    }),
  }),
  usage: z.object({ total: usedAtomicAmount, period: usedAtomicAmount }),
  remaining: z.object({ total: usedAtomicAmount, period: usedAtomicAmount.nullable() }),
  restrictions: z.object({
    merchantOrigins: z.array(merchantOrigin),
    recipients: z.array(walletAddress),
  }),
  expiresAt: z.iso.datetime().nullable(),
})

export const agentWalletNetworkSchema = z.object({
  network: networkId,
  mode: walletModeSchema,
  name: z.string(),
  family: accountFamily,
  paymentsEnabled: z.boolean(),
  account: walletAccountSchema.nullable(),
  asset: z.object({
    symbol: z.literal('USDC'),
    address: walletAddress,
    decimals: z.literal(6),
  }),
  delegation: z.object({
    status: z.enum(['active', 'inactive']),
    expiresAt: z.iso.datetime().nullable(),
  }),
  payment: z.object({
    ready: z.boolean(),
    maximumAmount: usedAtomicAmount.nullable(),
    blockers: z.array(agentWalletBlockerSchema),
  }),
})
export type AgentWalletNetwork = z.infer<typeof agentWalletNetworkSchema>

export const agentWalletSchema = z
  .object({
    budgets: z.array(agentBudgetSchema),
    networks: z.array(agentWalletNetworkSchema),
  })
  .openapi('AgentWallet')
export type AgentWallet = z.infer<typeof agentWalletSchema>

export const updateGrantSchema = budgetPolicy.openapi('UpdateGrant')
export type UpdateGrantInput = z.infer<typeof updateGrantSchema>

export const grantActionSchema = z.object({ action: z.enum(['pause', 'resume']) }).openapi('GrantAction')
export type GrantActionInput = z.infer<typeof grantActionSchema>

export const walletActionSchema = z.object({ action: z.enum(['pause', 'resume']) })
export type WalletActionInput = z.infer<typeof walletActionSchema>

export const paymentSummarySchema = z
  .object({
    id: z.string(),
    network: networkId,
    amount: atomicAmount,
    payTo: walletAddress,
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
    amount: usedAtomicAmount,
    decimals: z.number().int().nonnegative(),
    assetAddress: walletAddress.nullable(),
  })
  .openapi('WalletBalance')

export const walletRuntimeSchema = z
  .object({
    network: networkId,
    family: accountFamily,
    account: walletAccountSchema.nullable(),
    balances: z.array(walletBalanceSchema),
    balanceStatus: z.enum(['available', 'unavailable']),
    faucetAssets: z.array(z.enum(['usdc', 'native'])),
  })
  .openapi('WalletRuntime')
export type WalletRuntime = z.infer<typeof walletRuntimeSchema>

export const auditEventSchema = z.object({
  id: z.string(),
  actorKind: z.enum(['human', 'agent', 'system']),
  actorSubject: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
})

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

export const paymentPayloadSchema = z.object({
  x402Version: z.number().int().positive(),
  resource: paymentRequiredSchema.shape.resource,
  accepted: paymentOptionSchema,
  payload: z.record(z.string(), z.unknown()),
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export const paymentResultSchema = z
  .object({
    paymentId: resourceId,
    paymentPayload: paymentPayloadSchema,
    replayed: z.boolean(),
  })
  .openapi('PaymentResult')

export const agentPaymentSchema = z
  .object({
    paymentId: resourceId,
    status: z.enum(['reserved', 'signed', 'settled', 'failed']),
    network: networkId,
    asset: walletAddress,
    amount: atomicAmount,
    payTo: walletAddress,
    resource: z.url(),
    transactionHash: z.string().nullable(),
    failureReason: z.string().nullable(),
    authorizationExpiresAt: z.iso.datetime().nullable(),
    settledAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .openapi('AgentPayment')
export type AgentPayment = z.infer<typeof agentPaymentSchema>

export const settlementResponseSchema = z
  .object({
    success: z.boolean(),
    errorReason: z.string().optional(),
    errorMessage: z.string().optional(),
    payer: walletAddress.optional(),
    transaction: z.string().min(1),
    network: networkId,
    amount: z.string().regex(/^\d+$/).optional(),
    extensions: z.record(z.string(), z.unknown()).optional(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('SettlementResponse')
export type SettlementResponse = z.infer<typeof settlementResponseSchema>

export const settlementResultSchema = z.object({
  paymentId: resourceId,
  status: z.enum(['signed', 'settled']),
  transactionHash: z.string().nullable(),
})

export const faucetRequestSchema = z.object({
  network: networkId,
  asset: z.enum(['usdc', 'native']),
})
export type FaucetRequest = z.infer<typeof faucetRequestSchema>

export const faucetResultSchema = z.object({ transactionHash: z.string() })

export const apiErrorSchema = z
  .object({ error: z.string(), message: z.string() })
  .openapi('ApiError')
