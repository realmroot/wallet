import {
  agentGrantSchema,
  agentWalletSchema,
  budgetDecisionSchema,
  createBudgetRequestSchema,
  updateGrantSchema,
} from '../shared/contracts'
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

const policy = {
  totalLimit: '1000000',
  perTransactionLimit: '100000',
  periodKind: 'daily' as const,
  periodLimit: '250000',
  allowedOrigins: [],
  allowedRecipients: [],
  expiresAt: null,
}

describe('Agent identity contract', () => {
  it('removes local Agent names from the final database schema', async () => {
    const grantColumns = await env.DB
      .prepare('PRAGMA table_info(agent_grant)')
      .all<{ name: string }>()
    const requestColumns = await env.DB
      .prepare('PRAGMA table_info(budget_request)')
      .all<{ name: string }>()

    expect(grantColumns.results.map((column) => column.name)).not.toContain('name')
    expect(requestColumns.results.map((column) => column.name)).not.toContain('requested_name')
  })

  it('rejects caller-provided Agent names from budget and grant writes', () => {
    expect(
      createBudgetRequestSchema.safeParse({ mode: 'sandbox', name: 'Local Agent' }).success,
    ).toBe(false)
    expect(updateGrantSchema.safeParse({ ...policy, name: 'Local Agent' }).success).toBe(false)
    expect(budgetDecisionSchema.safeParse({
      decision: 'approve',
      approvalToken: 'a'.repeat(32),
      ...policy,
      name: 'Local Agent',
    }).success).toBe(false)
  })

  it('omits Agent names from Wallet-owned grant and budget representations', () => {
    expect('name' in agentGrantSchema.shape).toBe(false)
    expect('name' in agentWalletSchema.shape.budgets.element.shape).toBe(false)
  })
})
