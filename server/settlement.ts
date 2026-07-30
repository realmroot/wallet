import type { SettlementResponse } from '../shared/contracts'
import { ApiError, badRequest, conflict, upstreamError } from './errors'
import { walletChain, walletNetworkName } from './network'
import { createPublicClient, decodeEventLog, erc20Abi, http } from 'viem'

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
  if (response.payer && response.payer.toLowerCase() !== payment.wallet_address.toLowerCase()) {
    throw badRequest('Settlement payer does not match the Wallet.')
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(response.transaction)) {
    throw badRequest('Settlement transaction hash is invalid.')
  }
  if (
    payment.status === 'settled' &&
    payment.transaction_hash &&
    payment.transaction_hash.toLowerCase() !== response.transaction.toLowerCase()
  ) {
    throw conflict('The payment was already settled by another transaction.')
  }
  if (env.SIGNER_MODE === 'mock') return

  try {
    const receipt = await createPublicClient({
      chain: walletChain(env.WALLET_NETWORK),
      transport: http(env.WALLET_RPC_URL),
    }).getTransactionReceipt({ hash: response.transaction as `0x${string}` })
    if (receipt.status !== 'success') throw badRequest('The settlement transaction reverted.')

    const matched = hasMatchingUsdcTransfer(receipt.logs, payment)
    if (!matched) throw badRequest('The settlement transaction has no matching USDC transfer.')
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw upstreamError(
      `The settlement transaction is not confirmed on ${walletNetworkName(env.WALLET_NETWORK)}.`,
    )
  }
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
