import {
  listExpiredSignedPayments,
  markExpiredPaymentSettled,
  recordAuditEvent,
  releaseExpiredSignedPayment,
} from './repository'
import {
  walletChain,
  walletNetworkDefinition,
  walletNetworkRpcUrl,
} from './network'
import { getTransactionDecoder } from '@solana/kit'
import { createPublicClient, http, parseAbi } from 'viem'

const authorizationStateAbi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
])

export async function reconcileExpiredAuthorizations(env: Env) {
  if (env.SIGNER_MODE !== 'cdp') return 0
  const expired = await listExpiredSignedPayments(env.DB)
  if (expired.results.length === 0) return 0

  const results = await Promise.all(
    expired.results.map(async (payment) => {
      try {
        const definition = walletNetworkDefinition(payment.network)
        const reconciliation =
          definition.family === 'evm'
            ? { used: await evmAuthorizationUsed(env, payment) }
            : await reconcileSolanaPayment(env, payment)
        if (reconciliation.used) {
          await markExpiredPaymentSettled(env.DB, payment.id, reconciliation.transactionHash)
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
          action: reconciliation.used ? 'payment.reconciled_settled' : 'payment.expired_released',
          targetType: 'payment',
          targetId: payment.id,
          metadata: { network: payment.network, family: definition.family },
        })
        return true
      } catch (error) {
        console.error(
          JSON.stringify({
            message: 'expired authorization reconciliation failed',
            paymentId: payment.id,
            network: payment.network,
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        return false
      }
    }),
  )
  return results.filter(Boolean).length
}

async function evmAuthorizationUsed(
  env: Env,
  payment: { network: string; asset: string; payment_payload: string },
) {
  const authorization = paymentAuthorization(payment.payment_payload)
  return createPublicClient({
    chain: walletChain(payment.network),
    transport: http(walletNetworkRpcUrl(env, payment.network)),
  }).readContract({
    address: payment.asset as `0x${string}`,
    abi: authorizationStateAbi,
    functionName: 'authorizationState',
    args: [authorization.from, authorization.nonce],
  })
}

async function reconcileSolanaPayment(
  env: Env,
  payment: {
    network: string
    payment_payload: string
    wallet_address: string
    created_at: string
  },
) {
  const parsed = JSON.parse(payment.payment_payload) as {
    accepted?: { extra?: { lastValidBlockHeight?: unknown } }
    payload?: { transaction?: unknown }
  }
  const transaction = parsed.payload?.transaction
  if (typeof transaction !== 'string') throw new Error('Signed Solana payment is malformed.')
  const targetMessage = getTransactionDecoder().decode(decodeBase64(transaction)).messageBytes
  const rpcUrl = walletNetworkRpcUrl(env, payment.network)
  const signatures = await solanaRpc<Array<{ signature: string; blockTime: number | null }>>(
    rpcUrl,
    'getSignaturesForAddress',
    [payment.wallet_address, { limit: 100, commitment: 'confirmed' }],
  )
  for (const candidate of signatures) {
    if (candidate.blockTime && candidate.blockTime * 1000 < new Date(payment.created_at).getTime()) {
      break
    }
    const confirmed = await solanaRpc<{
      meta: { err: unknown } | null
      transaction: [string, 'base64']
    } | null>(
      rpcUrl,
      'getTransaction',
      [candidate.signature, {
        encoding: 'base64',
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      }],
    )
    if (!confirmed || confirmed.meta?.err) continue
    const message = getTransactionDecoder().decode(
      decodeBase64(confirmed.transaction[0]),
    ).messageBytes
    if (equalBytes(message, targetMessage)) {
      return { used: true, transactionHash: candidate.signature }
    }
  }
  const oldest = signatures.at(-1)?.blockTime
  if (signatures.length === 100 && oldest && oldest * 1000 > new Date(payment.created_at).getTime()) {
    throw new Error('Solana signature history is too busy to prove this payment is unsettled.')
  }
  const lastValid = parsed.accepted?.extra?.lastValidBlockHeight
  if (
    (typeof lastValid !== 'string' || !/^\d+$/.test(lastValid)) &&
    (typeof lastValid !== 'number' || !Number.isSafeInteger(lastValid))
  ) {
    throw new Error('Signed Solana payment has no last valid block height.')
  }
  const currentHeight = await solanaRpc<number>(rpcUrl, 'getBlockHeight', [
    { commitment: 'confirmed' },
  ])
  if (BigInt(currentHeight) <= BigInt(lastValid)) {
    throw new Error('Signed Solana payment is not past its last valid block height.')
  }
  return { used: false }
}

function decodeBase64(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}

function equalBytes(left: ArrayLike<number>, right: ArrayLike<number>) {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function solanaRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  })
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`)
  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? 'Solana RPC response is invalid.')
  }
  return body.result
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
