import { getTransactionDecoder } from '@solana/kit'
import { createPublicClient, http, parseAbi } from 'viem'
import {
  claimDueSignedPayments,
  markExpiredPaymentSettled,
  type ReconciliationPayment,
  releaseExpiredSignedPayment,
  rescheduleSignedPayment,
  retrySignedPaymentReconciliation,
} from './repository'
import {
  walletChain,
  walletNetworkDefinition,
  walletNetworkRpcUrl,
} from './network'

const authorizationStateAbi = parseAbi([
  'function authorizationState(address authorizer, bytes32 nonce) view returns (bool)',
])
const batchSize = 20
const maxBatches = 5
const paymentConcurrency = 5
const solanaTransactionConcurrency = 5
const leaseDurationMs = 5 * 60 * 1000
const pendingIntervalMs = 60 * 1000
const rpcTimeoutMs = 10 * 1000

export type ReconciliationResult =
  | { kind: 'settled'; transactionHash?: string }
  | { kind: 'pending' }
  | { kind: 'expired' }

export interface ReconciliationSummary {
  claimed: number
  settled: number
  released: number
  pending: number
  failed: number
}

interface ReconciliationDependencies {
  now?: () => Date
  inspect?: (
    env: Env,
    payment: ReconciliationPayment,
    now: Date,
  ) => Promise<ReconciliationResult>
}

export async function reconcileSignedPayments(
  env: Env,
  dependencies: ReconciliationDependencies = {},
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    claimed: 0,
    settled: 0,
    released: 0,
    pending: 0,
    failed: 0,
  }
  if (env.SIGNER_MODE !== 'cdp') return summary

  const now = dependencies.now?.() ?? new Date()
  const nowIso = now.toISOString()
  const leaseUntil = new Date(now.getTime() + leaseDurationMs).toISOString()
  const inspect = dependencies.inspect ?? inspectPaymentOnchain

  for (let page = 0; page < maxBatches; page += 1) {
    const payments = await claimDueSignedPayments(env.DB, {
      now: nowIso,
      leaseUntil,
      limit: batchSize,
    })
    if (payments.length === 0) break
    summary.claimed += payments.length
    await forEachConcurrent(payments, paymentConcurrency, async (payment) => {
      await reconcilePayment(env, payment, now, inspect, summary)
    })
    if (payments.length < batchSize) break
  }
  return summary
}

export const reconcileExpiredAuthorizations = reconcileSignedPayments

async function reconcilePayment(
  env: Env,
  payment: ReconciliationPayment,
  now: Date,
  inspect: NonNullable<ReconciliationDependencies['inspect']>,
  summary: ReconciliationSummary,
) {
  const definition = walletNetworkDefinition(payment.network)
  const metadata = { network: payment.network, family: definition.family }
  try {
    const result = await inspect(env, payment, now)
    if (result.kind === 'settled') {
      if (
        await markExpiredPaymentSettled(env.DB, {
          paymentId: payment.id,
          userId: payment.user_id,
          leaseId: payment.reconciliation_lease_id,
          transactionHash: result.transactionHash,
          metadata,
        })
      ) {
        summary.settled += 1
      }
      return
    }
    if (result.kind === 'expired') {
      if (
        await releaseExpiredSignedPayment(env.DB, {
          paymentId: payment.id,
          userId: payment.user_id,
          leaseId: payment.reconciliation_lease_id,
          grantId: payment.grant_id,
          amount: payment.amount,
          metadata,
        })
      ) {
        summary.released += 1
      }
      return
    }
    if (
      await rescheduleSignedPayment(env.DB, {
        paymentId: payment.id,
        leaseId: payment.reconciliation_lease_id,
        nextAt: new Date(now.getTime() + pendingIntervalMs).toISOString(),
      })
    ) {
      summary.pending += 1
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const delay = retryDelayMs(payment.reconciliation_failures)
    if (
      await retrySignedPaymentReconciliation(env.DB, {
        paymentId: payment.id,
        leaseId: payment.reconciliation_lease_id,
        nextAt: new Date(now.getTime() + delay).toISOString(),
        error: message,
      })
    ) {
      summary.failed += 1
      console.error(
        JSON.stringify({
          message: 'payment reconciliation failed',
          paymentId: payment.id,
          network: payment.network,
          retryInSeconds: delay / 1000,
          error: message,
        }),
      )
    }
  }
}

export async function inspectPaymentOnchain(
  env: Env,
  payment: ReconciliationPayment,
  now: Date,
): Promise<ReconciliationResult> {
  const definition = walletNetworkDefinition(payment.network)
  if (definition.family === 'evm') {
    if (await evmAuthorizationUsed(env, payment)) return { kind: 'settled' }
    return authorizationExpired(payment, now) ? { kind: 'expired' } : { kind: 'pending' }
  }
  return inspectSolanaPayment(env, payment)
}

async function evmAuthorizationUsed(
  env: Env,
  payment: Pick<ReconciliationPayment, 'network' | 'asset' | 'payment_payload'>,
) {
  const authorization = paymentAuthorization(payment.payment_payload)
  return createPublicClient({
    chain: walletChain(payment.network),
    transport: http(walletNetworkRpcUrl(env, payment.network), {
      timeout: rpcTimeoutMs,
      retryCount: 1,
    }),
  }).readContract({
    address: payment.asset as `0x${string}`,
    abi: authorizationStateAbi,
    functionName: 'authorizationState',
    args: [authorization.from, authorization.nonce],
  })
}

async function inspectSolanaPayment(
  env: Env,
  payment: Pick<
    ReconciliationPayment,
    'network' | 'payment_payload' | 'wallet_address' | 'created_at'
  >,
): Promise<ReconciliationResult> {
  const parsed = JSON.parse(payment.payment_payload) as {
    accepted?: { extra?: { lastValidBlockHeight?: unknown } }
    payload?: { transaction?: unknown }
  }
  const transaction = parsed.payload?.transaction
  if (typeof transaction !== 'string') throw new Error('Signed Solana payment is malformed.')
  if (!payment.wallet_address) throw new Error('Signed Solana payment has no Wallet account.')
  const targetMessage = getTransactionDecoder().decode(decodeBase64(transaction)).messageBytes
  const rpcUrl = walletNetworkRpcUrl(env, payment.network)
  const signatures = await solanaRpc<Array<{ signature: string; blockTime: number | null }>>(
    rpcUrl,
    'getSignaturesForAddress',
    [payment.wallet_address, { limit: 100, commitment: 'confirmed' }],
  )
  const createdAt = new Date(payment.created_at).getTime()
  const candidates = signatures.filter(
    (candidate) => candidate.blockTime === null || candidate.blockTime * 1000 >= createdAt,
  )
  let transactionHash: string | undefined
  await forEachConcurrent(candidates, solanaTransactionConcurrency, async (candidate) => {
    if (transactionHash) return
    const confirmed = await solanaRpc<{
      meta: { err: unknown } | null
      transaction: [string, 'base64']
    } | null>(rpcUrl, 'getTransaction', [
      candidate.signature,
      {
        encoding: 'base64',
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      },
    ])
    if (!confirmed || confirmed.meta?.err || transactionHash) return
    const message = getTransactionDecoder().decode(
      decodeBase64(confirmed.transaction[0]),
    ).messageBytes
    if (equalBytes(message, targetMessage)) transactionHash = candidate.signature
  })
  if (transactionHash) return { kind: 'settled', transactionHash }

  const oldest = signatures.at(-1)?.blockTime
  if (
    signatures.length === 100 &&
    (oldest === null || oldest === undefined || oldest * 1000 > createdAt)
  ) {
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
  return BigInt(currentHeight) > BigInt(lastValid) ? { kind: 'expired' } : { kind: 'pending' }
}

function authorizationExpired(
  payment: Pick<ReconciliationPayment, 'authorization_expires_at'>,
  now: Date,
) {
  const expiresAt = new Date(payment.authorization_expires_at).getTime()
  if (!Number.isFinite(expiresAt)) throw new Error('Signed payment has no valid expiration time.')
  return expiresAt <= now.getTime()
}

function retryDelayMs(failures: number) {
  return Math.min(15 * 60 * 1000, pendingIntervalMs * 2 ** Math.min(failures, 4))
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
    signal: AbortSignal.timeout(rpcTimeoutMs),
  })
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`)
  const body = (await response.json()) as { result?: T; error?: { message?: string } }
  if (body.error || body.result === undefined) {
    throw new Error(body.error?.message ?? 'Solana RPC response is invalid.')
  }
  return body.result
}

async function forEachConcurrent<T>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<void>,
) {
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const value = values[nextIndex]!
        nextIndex += 1
        await operation(value)
      }
    }),
  )
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
