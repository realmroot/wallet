import type {
  AgentGrant,
  AgentWallet,
  AgentWalletBlocker,
  WalletRuntime,
  WalletUser,
} from '../shared/contracts'
import { walletAsset } from './cdp'

export function buildAgentWallet(
  env: Env,
  user: WalletUser | null,
  grant: AgentGrant | null,
  runtime: WalletRuntime | null,
): AgentWallet {
  const blockers: AgentWalletBlocker[] = []
  const now = Date.now()
  const delegationActive = Boolean(
    user?.walletAddress &&
      user.cdpUserId &&
      user.delegationExpiresAt &&
      new Date(user.delegationExpiresAt).getTime() > now,
  )

  if (!user?.walletAddress || !user.cdpUserId) blockers.push('wallet_not_provisioned')
  if (user?.pausedAt) blockers.push('wallet_paused')
  if (user?.walletAddress && !delegationActive) blockers.push('delegation_inactive')

  if (!grant) blockers.push('budget_not_granted')
  if (grant?.pausedAt) blockers.push('budget_paused')
  if (grant?.expiresAt && new Date(grant.expiresAt).getTime() <= now) {
    blockers.push('budget_expired')
  }

  const asset = walletAsset(env)
  const balance =
    runtime?.balanceStatus === 'available'
      ? runtime.balances.find((item) => item.contractAddress?.toLowerCase() === asset.address.toLowerCase())
      : undefined
  if (grant && runtime?.balanceStatus === 'unavailable') blockers.push('funding_unavailable')

  let maximumAmount: string | null = null
  let budget: AgentWallet['budget'] = null
  if (grant) {
    const remainingTotal = nonnegativeDifference(grant.totalLimit, grant.spentTotal)
    const remainingPeriod = grant.periodLimit
      ? nonnegativeDifference(grant.periodLimit, grant.periodSpent)
      : null
    if (remainingTotal === 0n) blockers.push('total_limit_reached')
    if (remainingPeriod === 0n) blockers.push('period_limit_reached')
    if (balance && BigInt(balance.amount) === 0n) blockers.push('insufficient_funds')

    if (balance) {
      const limits = [
        BigInt(balance.amount),
        BigInt(grant.perTransactionLimit),
        remainingTotal,
        ...(remainingPeriod === null ? [] : [remainingPeriod]),
      ]
      maximumAmount = limits.reduce((minimum, value) => (value < minimum ? value : minimum)).toString()
    }

    budget = {
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
        period: {
          kind: grant.periodKind,
          amount: grant.periodLimit,
        },
      },
      usage: {
        total: grant.spentTotal,
        period: grant.periodSpent,
      },
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
  }

  return {
    network: env.WALLET_NETWORK,
    asset: {
      symbol: asset.symbol,
      contractAddress: asset.address,
      decimals: asset.decimals,
    },
    delegation: {
      status: delegationActive ? 'active' : 'inactive',
      expiresAt: user?.delegationExpiresAt ?? null,
    },
    budget,
    payment: {
      ready: blockers.length === 0 && maximumAmount !== null && BigInt(maximumAmount) > 0n,
      maximumAmount,
      blockers,
    },
  }
}

function nonnegativeDifference(limit: string, spent: string) {
  const difference = BigInt(limit) - BigInt(spent)
  return difference > 0n ? difference : 0n
}
