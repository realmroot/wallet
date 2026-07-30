export const agentScopes = {
  walletRead: {
    value: 'wallet:read',
    description: 'Inspect the Wallet delegated to the current Agent.',
  },
  budgetRequest: {
    value: 'wallet:budget:request',
    description: 'Request and track a controller-approved Agent budget.',
  },
  x402Pay: {
    value: 'wallet:x402:pay',
    description: 'Create x402 payments within a controller-approved Agent budget.',
  },
} as const

export const agentOperations = {
  getWallet: {
    operationId: 'getAgentWallet',
    scope: agentScopes.walletRead.value,
  },
  createBudgetRequest: {
    operationId: 'createBudgetRequest',
    scope: agentScopes.budgetRequest.value,
  },
  getBudgetRequest: {
    operationId: 'getBudgetRequest',
    scope: agentScopes.budgetRequest.value,
  },
  createPaymentAuthorization: {
    operationId: 'createPaymentAuthorization',
    scope: agentScopes.x402Pay.value,
  },
  getPayment: {
    operationId: 'getPayment',
    scope: agentScopes.x402Pay.value,
  },
  confirmPaymentSettlement: {
    operationId: 'confirmPaymentSettlement',
    scope: agentScopes.x402Pay.value,
  },
} as const

export type AgentOperationId =
  (typeof agentOperations)[keyof typeof agentOperations]['operationId']
type AgentOperationPolicy = (typeof agentOperations)[keyof typeof agentOperations]

export const agentScopeCatalog = Object.fromEntries(
  Object.values(agentScopes).map(({ value, description }) => [value, description]),
)

const policiesByOperationId: ReadonlyMap<string, AgentOperationPolicy> = new Map(
  Object.values(agentOperations).map((policy) => [policy.operationId, policy]),
)

export function getAgentOperationPolicy(operationId: string) {
  return policiesByOperationId.get(operationId)
}

export function requireAgentOperationPolicy(operationId: string) {
  const policy = getAgentOperationPolicy(operationId)
  if (!policy) throw new Error(`Agent operation ${operationId} has no authorization policy.`)
  return policy
}
