import { z } from 'zod'

const atomicAmount = z.string().regex(/^[1-9]\d{0,14}$/)
export const paymentRequiredSchema = z.object({
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
        payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        maxTimeoutSeconds: z.number().int().positive(),
        extra: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
})

export const createBudgetRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
})

export const inspectBudgetRequestSchema = z.object({
  approvalToken: z.string().min(32).max(255),
})

const budgetPolicy = z.object({
  name: z.string().trim().min(1).max(100),
  totalLimit: atomicAmount,
  perTransactionLimit: atomicAmount,
  periodKind: z.enum(['none', 'daily', 'monthly']),
  periodLimit: atomicAmount.nullable(),
  expiresAt: z.iso.datetime().nullable(),
})

export const budgetDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('deny'),
    approvalToken: z.string().min(32).max(255),
  }),
  budgetPolicy.extend({
    decision: z.literal('approve'),
    approvalToken: z.string().min(32).max(255),
  }),
])

export const updateWalletSchema = z.object({
  cdpUserId: z.string().trim().min(1).max(100),
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegationExpiresAt: z.iso.datetime().nullable(),
})

export type PaymentRequired = z.infer<typeof paymentRequiredSchema>
export type BudgetDecisionInput = z.infer<typeof budgetDecisionSchema>

export type BudgetRequestStatus = 'pending' | 'approved' | 'denied' | 'expired'

export interface BudgetRequestState {
  id: string
  status: BudgetRequestStatus
  expiresAt: string
  grantId: string | null
  approvalUrl?: string
  interval?: number
}

export interface BudgetRequestDetail extends BudgetRequestState {
  agentIssuer: string
  agentSubject: string
  requestedName: string | null
}

export interface WalletUser {
  id: string
  issuer: string
  subject: string
  email: string | null
  cdpUserId: string | null
  walletAddress: string | null
  delegationExpiresAt: string | null
}

export interface AgentGrant {
  id: string
  agentIssuer: string
  agentSubject: string
  name: string
  totalLimit: string
  spentTotal: string
  perTransactionLimit: string
  periodKind: 'none' | 'daily' | 'monthly'
  periodLimit: string | null
  periodSpent: string
  expiresAt: string | null
  revokedAt: string | null
}

export interface WalletOverview {
  user: WalletUser
  grants: AgentGrant[]
  payments: Array<{
    id: string
    amount: string
    payTo: string
    resource: string
    status: string
    createdAt: string
  }>
}
