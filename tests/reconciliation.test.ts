import { env } from 'cloudflare:test'
import {
  inspectPaymentOnchain,
  reconcileSignedPayments,
  type ReconciliationResult,
} from '../server/reconciliation'
import { settlePayment, type ReconciliationPayment } from '../server/repository'
import { walletBindings } from '../server/runtime-config'
import { afterEach, describe, expect, it, vi } from 'vitest'

const now = new Date('2026-08-11T12:00:00.000Z')
const evmNetwork = 'eip155:84532'
const solanaNetwork = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const evmAsset = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

afterEach(() => vi.restoreAllMocks())

describe('payment reconciliation', () => {
  it('classifies EVM authorization state before deciding pending or expired', async () => {
    const payment = reconciliationPayment({ network: evmNetwork, family: 'evm' })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(jsonRpcResult(`0x${'0'.repeat(63)}1`))
    await expect(inspectPaymentOnchain(cdpEnv(), payment, now)).resolves.toEqual({
      kind: 'settled',
    })

    fetchMock.mockResolvedValueOnce(jsonRpcResult(`0x${'0'.repeat(64)}`))
    await expect(
      inspectPaymentOnchain(cdpEnv(), {
        ...payment,
        authorization_expires_at: '2026-08-11T12:01:00.000Z',
      }, now),
    ).resolves.toEqual({ kind: 'pending' })

    fetchMock.mockResolvedValueOnce(jsonRpcResult(`0x${'0'.repeat(64)}`))
    await expect(
      inspectPaymentOnchain(cdpEnv(), {
        ...payment,
        authorization_expires_at: '2026-08-11T11:59:00.000Z',
      }, now),
    ).resolves.toEqual({ kind: 'expired' })
  })

  it('finds an exact confirmed Solana transaction and waits while its blockhash is valid', async () => {
    const transaction = testSolanaTransaction()
    const payment = reconciliationPayment({
      network: solanaNetwork,
      family: 'solana',
      paymentPayload: JSON.stringify({
        accepted: { extra: { lastValidBlockHeight: '100' } },
        payload: { transaction },
      }),
    })
    mockSolanaRpc({ transaction })
    await expect(inspectPaymentOnchain(cdpEnv(), payment, now)).resolves.toEqual({
      kind: 'settled',
      transactionHash: 'confirmed-signature',
    })

    mockSolanaRpc({ transaction: null, blockHeight: 100 })
    await expect(inspectPaymentOnchain(cdpEnv(), payment, now)).resolves.toEqual({
      kind: 'pending',
    })
  })

  it('settles and releases due payments while updating audit and budget atomically', async () => {
    await seedSignedPayment({ id: 'evm-settled', network: evmNetwork, family: 'evm' })
    await seedSignedPayment({ id: 'solana-expired', network: solanaNetwork, family: 'solana' })
    const inspect = vi.fn(async (_env: Env, payment: ReconciliationPayment) =>
      payment.network === evmNetwork
        ? ({ kind: 'settled', transactionHash: '0xsettled' } satisfies ReconciliationResult)
        : ({ kind: 'expired' } satisfies ReconciliationResult),
    )

    const summary = await reconcileSignedPayments(cdpEnv(), { now: () => now, inspect })

    expect(summary).toEqual({ claimed: 2, settled: 1, released: 1, pending: 0, failed: 0 })
    expect(await paymentState('evm-settled')).toMatchObject({
      status: 'settled',
      transaction_hash: '0xsettled',
      next_reconciliation_at: null,
    })
    expect(await paymentState('solana-expired')).toMatchObject({
      status: 'failed',
      error: 'Signed authorization expired without settlement.',
      next_reconciliation_at: null,
    })
    const grant = await env.DB.prepare('SELECT spent_total, period_spent FROM agent_grant WHERE id = ?')
      .bind('grant-solana-expired')
      .first<{ spent_total: string; period_spent: string }>()
    expect(grant).toEqual({ spent_total: '75', period_spent: '75' })
    const audit = await env.DB.prepare(
      'SELECT action FROM audit_event ORDER BY action',
    ).all<{ action: string }>()
    expect(audit.results.map((event) => event.action)).toEqual([
      'payment.expired_released',
      'payment.reconciled_settled',
    ])
  })

  it('backs off RPC failures and clears the lease for a later retry', async () => {
    await seedSignedPayment({ id: 'rpc-failure', network: evmNetwork, family: 'evm' })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const summary = await reconcileSignedPayments(cdpEnv(), {
      now: () => now,
      inspect: async () => {
        throw new Error('RPC unavailable')
      },
    })

    expect(summary).toEqual({ claimed: 1, settled: 0, released: 0, pending: 0, failed: 1 })
    expect(await paymentState('rpc-failure')).toMatchObject({
      status: 'signed',
      reconciliation_lease_until: null,
      reconciliation_failures: 1,
      last_reconciliation_error: 'RPC unavailable',
      next_reconciliation_at: '2026-08-11T12:01:00.000Z',
    })
  })

  it('leases a signed payment so overlapping scheduled runs inspect it once', async () => {
    await seedSignedPayment({ id: 'leased-once', network: evmNetwork, family: 'evm' })
    const inspect = vi.fn(async () => ({ kind: 'pending' } as const))

    const summaries = await Promise.all([
      reconcileSignedPayments(cdpEnv(), { now: () => now, inspect }),
      reconcileSignedPayments(cdpEnv(), { now: () => now, inspect }),
    ])

    expect(inspect).toHaveBeenCalledTimes(1)
    expect(summaries.reduce((total, summary) => total + summary.claimed, 0)).toBe(1)
    expect(await paymentState('leased-once')).toMatchObject({
      status: 'signed',
      reconciliation_lease_until: null,
      next_reconciliation_at: '2026-08-11T12:01:00.000Z',
    })
  })

  it('does not overwrite a manual confirmation that wins the reconciliation race', async () => {
    await seedSignedPayment({ id: 'manual-wins', network: evmNetwork, family: 'evm' })
    let releaseInspection!: () => void
    let inspectionStarted!: () => void
    const started = new Promise<void>((resolve) => {
      inspectionStarted = resolve
    })
    const blocked = new Promise<void>((resolve) => {
      releaseInspection = resolve
    })
    const run = reconcileSignedPayments(cdpEnv(), {
      now: () => now,
      inspect: async () => {
        inspectionStarted()
        await blocked
        return { kind: 'expired' }
      },
    })
    await started
    await settlePayment(env.DB, 'manual-wins', {
      success: true,
      transaction: '0xmanual',
      network: evmNetwork,
      payer: '0x1111111111111111111111111111111111111111',
    })
    releaseInspection()

    expect(await run).toEqual({ claimed: 1, settled: 0, released: 0, pending: 0, failed: 0 })
    expect(await paymentState('manual-wins')).toMatchObject({
      status: 'settled',
      transaction_hash: '0xmanual',
    })
    const grant = await env.DB.prepare('SELECT spent_total FROM agent_grant WHERE id = ?')
      .bind('grant-manual-wins')
      .first<{ spent_total: string }>()
    expect(grant?.spent_total).toBe('100')
    const audit = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM audit_event
       WHERE target_id = ? AND actor_subject = 'payment-maintenance'`,
    ).bind('manual-wins').first<{ count: number }>()
    expect(audit?.count).toBe(0)
  })
})

function cdpEnv(): Env {
  return { ...walletBindings(env), SIGNER_MODE: 'cdp' }
}

function reconciliationPayment(input: {
  network: string
  family: 'evm' | 'solana'
  paymentPayload?: string
}): ReconciliationPayment {
  return {
    id: 'payment-id',
    user_id: 'user-id',
    grant_id: 'grant-id',
    account_id: 'account-id',
    network: input.network,
    amount: '25',
    asset: evmAsset,
    payment_payload:
      input.paymentPayload ??
      JSON.stringify({
        payload: {
          authorization: {
            from: '0x1111111111111111111111111111111111111111',
            nonce: `0x${'11'.repeat(32)}`,
          },
        },
      }),
    authorization_expires_at: '2026-08-11T12:01:00.000Z',
    created_at: '2026-08-11T11:58:00.000Z',
    wallet_address:
      input.family === 'evm'
        ? '0x1111111111111111111111111111111111111111'
        : '11111111111111111111111111111111',
    reconciliation_failures: 0,
    reconciliation_lease_id: 'test-lease',
  }
}

async function seedSignedPayment(input: {
  id: string
  network: string
  family: 'evm' | 'solana'
}) {
  const userId = `user-${input.id}`
  const grantId = `grant-${input.id}`
  const accountId = `account-${input.id}`
  const address =
    input.family === 'evm'
      ? `0x${input.id.length.toString(16).padStart(40, '0')}`
      : `solana-address-${input.id}`
  const timestamp = '2026-08-11T11:00:00.000Z'
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO wallet_user (id, issuer, subject, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(userId, 'https://issuer.test', userId, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO wallet_account (
         id, user_id, family, address, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(accountId, userId, input.family, address, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO agent_grant (
         id, user_id, agent_issuer, agent_subject, mode, total_limit, spent_total,
         per_transaction_limit, period_kind, period_spent, period_started_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'sandbox', '1000', '100', '1000', 'daily', '100', ?, ?, ?)`,
    ).bind(grantId, userId, 'https://issuer.test', `agent-${input.id}`, timestamp, timestamp, timestamp),
    env.DB.prepare(
      `INSERT INTO payment (
         id, user_id, grant_id, account_id, idempotency_key, requirement_hash,
         network, mode, asset, amount, pay_to, resource, status, payment_payload,
         authorization_expires_at, next_reconciliation_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sandbox', ?, '25', ?, ?, 'signed', '{}', ?, ?, ?, ?)`,
    ).bind(
      input.id,
      userId,
      grantId,
      accountId,
      `key-${input.id}`,
      `hash-${input.id}`,
      input.network,
      evmAsset,
      address,
      'https://merchant.test/resource',
      '2026-08-11T11:59:00.000Z',
      timestamp,
      timestamp,
      timestamp,
    ),
  ])
}

async function paymentState(paymentId: string) {
  return env.DB.prepare(
    `SELECT status, transaction_hash, error, next_reconciliation_at,
            reconciliation_lease_until, reconciliation_failures,
            last_reconciliation_error
     FROM payment WHERE id = ?`,
  ).bind(paymentId).first()
}

function jsonRpcResult(result: string) {
  return Response.json({ jsonrpc: '2.0', id: 1, result })
}

function mockSolanaRpc(input: { transaction: string | null; blockHeight?: number }) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { id: string; method: string }
    if (body.method === 'getSignaturesForAddress') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: input.transaction
          ? [{ signature: 'confirmed-signature', blockTime: 1_786_449_540 }]
          : [],
      })
    }
    if (body.method === 'getTransaction' && input.transaction) {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { meta: { err: null }, transaction: [input.transaction, 'base64'] },
      })
    }
    if (body.method === 'getBlockHeight') {
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: input.blockHeight ?? 101,
      })
    }
    return new Response('Unexpected Solana RPC method.', { status: 500 })
  })
}

function testSolanaTransaction() {
  const bytes = new Uint8Array(134)
  bytes[0] = 1
  bytes[65] = 1
  bytes[68] = 1
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
