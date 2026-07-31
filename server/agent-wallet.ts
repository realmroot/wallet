import type {
  AgentGrant,
  AgentWallet,
  AgentWalletBlocker,
  WalletRuntime,
  WalletUser,
} from '../shared/contracts'
import {
  networkPaymentsEnabled,
  walletNetworkDefinition,
  walletNetworks,
} from './network'

export function buildAgentWallet(
  env: Env,
  user: WalletUser | null,
  grant: AgentGrant | null,
  runtimes: WalletRuntime[],
): AgentWallet {
  const now = Date.now()
  const remainingTotal = grant
    ? nonnegativeDifference(grant.totalLimit, grant.spentTotal)
    : 0n
  const remainingPeriod =
    grant?.periodLimit ? nonnegativeDifference(grant.periodLimit, grant.periodSpent) : null

  const budget: AgentWallet['budget'] = grant
    ? {
        id: grant.id,
        name: grant.name,
        status: grant.pausedAt
          ? 'paused'
          : grant.expiresAt && new Date(grant.expiresAt).getTime() <= now
            ? 'expired'
            : 'active',
        limits: {
          total: grant.totalLimit,
          perPayment: grant.perTransactionLimit,
          period: { kind: grant.periodKind, amount: grant.periodLimit },
        },
        usage: { total: grant.spentTotal, period: grant.periodSpent },
        remaining: {
          total: remainingTotal.toString(),
          period: remainingPeriod?.toString() ?? null,
        },
        restrictions: {
          merchantOrigins: grant.allowedOrigins,
          recipients: grant.allowedRecipients,
        },
        expiresAt: grant.expiresAt,
      }
    : null

  return {
    budget,
    networks: walletNetworks(env).map((definition) => {
      const runtime = runtimes.find((candidate) => candidate.network === definition.id) ?? null
      const account = user?.accounts.find((candidate) => candidate.family === definition.family) ?? null
      const blockers: AgentWalletBlocker[] = []
      if (!networkPaymentsEnabled(env, definition.id)) blockers.push('payments_disabled')
      if (!account || !user?.cdpUserId) blockers.push('wallet_not_provisioned')
      if (user?.pausedAt) blockers.push('wallet_paused')
      const delegationActive = Boolean(
        account?.delegationExpiresAt &&
          new Date(account.delegationExpiresAt).getTime() > now,
      )
      if (account && !delegationActive) blockers.push('delegation_inactive')
      if (!grant) blockers.push('budget_not_granted')
      if (grant?.pausedAt) blockers.push('budget_paused')
      if (grant?.expiresAt && new Date(grant.expiresAt).getTime() <= now) {
        blockers.push('budget_expired')
      }
      if (grant && runtime?.balanceStatus === 'unavailable') blockers.push('funding_unavailable')
      if (remainingTotal === 0n && grant) blockers.push('total_limit_reached')
      if (remainingPeriod === 0n && grant) blockers.push('period_limit_reached')

      const balance = runtime?.balances.find(
        (item) => item.assetAddress === definition.asset.address,
      )
      if (balance && BigInt(balance.amount) === 0n) blockers.push('insufficient_funds')
      let maximumAmount: string | null = null
      if (grant && balance) {
        maximumAmount = [
          BigInt(balance.amount),
          BigInt(grant.perTransactionLimit),
          remainingTotal,
          ...(remainingPeriod === null ? [] : [remainingPeriod]),
        ]
          .reduce((minimum, value) => (value < minimum ? value : minimum))
          .toString()
      }

      return {
        network: definition.id,
        name: definition.name,
        family: definition.family,
        paymentsEnabled: networkPaymentsEnabled(env, definition.id),
        account,
        asset: definition.asset,
        delegation: {
          status: delegationActive ? 'active' : 'inactive',
          expiresAt: account?.delegationExpiresAt ?? null,
        },
        payment: {
          ready: blockers.length === 0 && maximumAmount !== null && BigInt(maximumAmount) > 0n,
          maximumAmount,
          blockers,
        },
      }
    }),
  }
}

function nonnegativeDifference(limit: string, spent: string) {
  const difference = BigInt(limit) - BigInt(spent)
  return difference > 0n ? difference : 0n
}
