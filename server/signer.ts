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
        typedData: withExplicitEip712Domain(typedData),
        idempotencyKey: input.idempotencyKey,
      })
      return result.signature as `0x${string}`
    },
  }
}

interface Eip712Input {
  domain?: {
    name?: string
    version?: string
    chainId?: number | bigint
    verifyingContract?: string
    salt?: string
  }
  types: Record<string, unknown>
  primaryType: string
  message: Record<string, unknown>
}

export function withExplicitEip712Domain(typedData: Eip712Input) {
  const domain = typedData.domain ?? {}
  const { chainId, ...domainWithoutChainId } = domain
  const fields = [
    ['name', 'string'],
    ['version', 'string'],
    ['chainId', 'uint256'],
    ['verifyingContract', 'address'],
    ['salt', 'bytes32'],
  ] as const
  const eip712Domain =
    typedData.types.EIP712Domain ??
    fields
      .filter(([name]) => domain[name] !== undefined)
      .map(([name, type]) => ({ name, type }))

  return {
    domain: {
      ...domainWithoutChainId,
      ...(chainId === undefined ? {} : { chainId: Number(chainId) }),
    },
    types: {
      ...typedData.types,
      EIP712Domain: eip712Domain,
    },
    primaryType: typedData.primaryType,
    message: typedData.message,
  }
}
