import type { SettlementResponse } from '../shared/contracts'
import { ApiError, badRequest, conflict, tooEarly, upstreamError } from './errors'
import {
  walletChain,
  walletNetworkDefinition,
  walletNetworkName,
  walletNetworkRpcUrl,
} from './network'
import {
  createPublicClient,
  decodeEventLog,
  erc20Abi,
  http,
  TransactionReceiptNotFoundError,
} from 'viem'

interface ExpectedSettlement {
  network: string
  asset: string
  amount: string
  pay_to: string
  wallet_address: string
  status: string
  transaction_hash: string | null
}

export async function verifySettlement(
  env: Env,
  payment: ExpectedSettlement,
  response: SettlementResponse,
) {
  if (!response.success) return
  if (response.network !== payment.network) throw badRequest('Settlement network does not match the payment.')
  if (response.amount && response.amount !== payment.amount) {
    throw badRequest('Settlement amount does not match the payment.')
  }
  const definition = walletNetworkDefinition(payment.network)
  if (
    response.payer &&
    normalize(definition.family, response.payer) !== normalize(definition.family, payment.wallet_address)
  ) {
    throw badRequest('Settlement payer does not match the Wallet.')
  }
  validateTransactionId(definition.family, response.transaction)
  if (
    payment.status === 'settled' &&
    payment.transaction_hash &&
    normalize(definition.family, payment.transaction_hash) !== normalize(definition.family, response.transaction)
  ) {
    throw conflict('The payment was already settled by another transaction.')
  }
  if (env.SIGNER_MODE === 'mock') return

  try {
    if (definition.family === 'evm') {
      await verifyEvmSettlement(env, payment, response.transaction)
    } else {
      await verifySolanaSettlement(env, payment, response.transaction)
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof TransactionReceiptNotFoundError) {
      throw tooEarly(
        `The settlement transaction is not confirmed on ${walletNetworkName(payment.network)}.`,
      )
    }
    throw upstreamError(
      `The settlement transaction is not confirmed on ${walletNetworkName(payment.network)}.`,
    )
  }
}

async function verifyEvmSettlement(
  env: Env,
  payment: ExpectedSettlement,
  transaction: string,
) {
  const receipt = await createPublicClient({
    chain: walletChain(payment.network),
    transport: http(walletNetworkRpcUrl(env, payment.network)),
  }).getTransactionReceipt({ hash: transaction as `0x${string}` })
  if (receipt.status !== 'success') throw badRequest('The settlement transaction reverted.')
  if (!hasMatchingUsdcTransfer(receipt.logs, payment)) {
    throw badRequest('The settlement transaction has no matching USDC transfer.')
  }
}

async function verifySolanaSettlement(
  env: Env,
  payment: ExpectedSettlement,
  signature: string,
) {
  const result = await solanaRpc<SolanaTransaction | null>(
    walletNetworkRpcUrl(env, payment.network),
    'getTransaction',
    [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
  )
  if (!result) throw tooEarly('The Solana settlement transaction is not confirmed.')
  if (result.meta?.err) throw badRequest('The Solana settlement transaction failed.')
  if (!hasMatchingSolanaTransfer(result, payment)) {
    throw badRequest('The settlement transaction has no matching USDC transfer.')
  }
}

interface SolanaTokenBalance {
  accountIndex: number
  mint: string
  owner?: string
  uiTokenAmount: { amount: string }
}

interface SolanaTransaction {
  meta: {
    err: unknown
    preTokenBalances?: SolanaTokenBalance[]
    postTokenBalances?: SolanaTokenBalance[]
  } | null
}

export function hasMatchingSolanaTransfer(
  transaction: SolanaTransaction,
  payment: Pick<ExpectedSettlement, 'asset' | 'amount' | 'pay_to' | 'wallet_address'>,
) {
  const pre = transaction.meta?.preTokenBalances ?? []
  const post = transaction.meta?.postTokenBalances ?? []
  const change = (owner: string) => {
    const before = tokenTotal(pre, payment.asset, owner)
    const after = tokenTotal(post, payment.asset, owner)
    return after - before
  }
  const amount = BigInt(payment.amount)
  return change(payment.wallet_address) <= -amount && change(payment.pay_to) >= amount
}

function tokenTotal(balances: SolanaTokenBalance[], mint: string, owner: string) {
  return balances
    .filter((balance) => balance.mint === mint && balance.owner === owner)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount), 0n)
}

export function hasMatchingUsdcTransfer(
  logs: ReadonlyArray<{
    address: string
    data: `0x${string}`
    topics: readonly (`0x${string}` | `0x${string}`[] | null)[]
  }>,
  payment: Pick<ExpectedSettlement, 'asset' | 'amount' | 'pay_to' | 'wallet_address'>,
) {
  return logs.some((log) => {
    if (log.address.toLowerCase() !== payment.asset.toLowerCase()) return false
    try {
      const topics = log.topics.filter(
        (topic): topic is `0x${string}` => typeof topic === 'string',
      )
      if (!topics[0]) return false
      const event = decodeEventLog({
        abi: erc20Abi,
        eventName: 'Transfer',
        data: log.data,
        topics: topics as [`0x${string}`, ...`0x${string}`[]],
      })
      return (
        event.args.from?.toLowerCase() === payment.wallet_address.toLowerCase() &&
        event.args.to?.toLowerCase() === payment.pay_to.toLowerCase() &&
        event.args.value === BigInt(payment.amount)
      )
    } catch {
      return false
    }
  })
}

function validateTransactionId(family: 'evm' | 'solana', value: string) {
  const valid =
    family === 'evm'
      ? /^0x[0-9a-fA-F]{64}$/.test(value)
      : /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value)
  if (!valid) throw badRequest('Settlement transaction identifier is invalid.')
}

function normalize(family: 'evm' | 'solana', value: string) {
  return family === 'evm' ? value.toLowerCase() : value
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
    throw new Error(body.error?.message ?? 'Solana RPC returned an invalid response.')
  }
  return body.result
}
