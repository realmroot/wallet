import {
  listExpiredSignedPayments,
  markExpiredPaymentSettled,
  recordAuditEvent,
  releaseExpiredSignedPayment,
} from './repository'
import { createPublicClient, http, parseAbi } from 'viem'
import { baseSepolia } from 'viem/chains'

const authorizationStateAbi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
])

export async function reconcileExpiredAuthorizations(env: Env) {
  if (env.SIGNER_MODE !== 'cdp' || env.WALLET_NETWORK !== 'eip155:84532') return 0
  const expired = await listExpiredSignedPayments(env.DB)
  if (expired.results.length === 0) return 0

  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(env.WALLET_RPC_URL),
  })
  const results = await Promise.all(
    expired.results.map(async (payment) => {
      try {
        const authorization = paymentAuthorization(payment.payment_payload)
        const used = await client.readContract({
          address: payment.asset as `0x${string}`,
          abi: authorizationStateAbi,
          functionName: 'authorizationState',
          args: [authorization.from, authorization.nonce],
        })
        if (used) {
          await markExpiredPaymentSettled(env.DB, payment.id)
        } else {
          await releaseExpiredSignedPayment(env.DB, {
            paymentId: payment.id,
            grantId: payment.grant_id,
            amount: payment.amount,
          })
        }
        await recordAuditEvent(env.DB, {
          userId: payment.user_id,
          actorKind: 'system',
          actorSubject: 'payment-maintenance',
          action: used ? 'payment.reconciled_settled' : 'payment.expired_released',
          targetType: 'payment',
          targetId: payment.id,
        })
        return true
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'expired authorization reconciliation failed',
            paymentId: payment.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        return false
      }
    }),
  )
  return results.filter(Boolean).length
}

function paymentAuthorization(serialized: string) {
  const parsed = JSON.parse(serialized) as {
    payload?: {
      authorization?: {
        from?: unknown
        nonce?: unknown
      }
    }
  }
  const from = parsed.payload?.authorization?.from
  const nonce = parsed.payload?.authorization?.nonce
  if (
    typeof from !== 'string' ||
    !/^0x[0-9a-fA-F]{40}$/.test(from) ||
    typeof nonce !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(nonce)
  ) {
    throw new Error('Signed payment authorization is malformed.')
  }
  return {
    from: from as `0x${string}`,
    nonce: nonce as `0x${string}`,
  }
}
