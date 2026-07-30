import type { PaymentRequired } from '../shared/contracts'
import { createCdpClient } from './cdp'
import { x402Client } from '@x402/core/client'
import type { ClientEvmSigner } from '@x402/evm'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

interface WalletSignerInput {
  cdpUserId: string
  address: `0x${string}`
  paymentRequired: PaymentRequired
  idempotencyKey: string
}

export async function createX402Payment(env: Env, input: WalletSignerInput) {
  const signer = createSigner(env, input)
  const client = new x402Client()
  registerExactEvmScheme(client, {
    signer,
    networks: [env.WALLET_NETWORK as `${string}:${string}`],
  })
  return client.createPaymentPayload(input.paymentRequired)
}

function createSigner(env: Env, input: WalletSignerInput): ClientEvmSigner {
  if (env.SIGNER_MODE === 'mock') {
    if (!env.MOCK_SIGNER_PRIVATE_KEY) throw new Error('MOCK_SIGNER_PRIVATE_KEY is required in mock signer mode.')
    const account = privateKeyToAccount(env.MOCK_SIGNER_PRIVATE_KEY as `0x${string}`)
    if (account.address.toLowerCase() !== input.address.toLowerCase()) {
      throw new Error('Configured mock signer does not match the Wallet address.')
    }
    return account
  }
  if (
    !env.CDP_API_KEY_ID ||
    !env.CDP_API_KEY_SECRET ||
    !env.CDP_WALLET_SECRET
  ) {
    throw new Error('CDP server credentials are not configured.')
  }
  return {
    address: input.address,
    async signTypedData(typedData) {
      const cdp = createCdpClient(env)
      const result = await cdp.endUser.signEvmTypedData({
        userId: input.cdpUserId,
        address: input.address,
        typedData,
        idempotencyKey: input.idempotencyKey,
      })
      return result.signature as `0x${string}`
    },
  }
}
