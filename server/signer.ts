import type { PaymentRequired } from '../shared/contracts'
import { createCdpClient, isInactiveDelegationError } from './cdp'
import { forbidden } from './errors'
import { x402Client } from '@x402/core/client'
import type { PaymentPayload } from '@x402/core/types'
import type { ClientEvmSigner } from '@x402/evm'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

const paymentIdentifierPattern = /^[A-Za-z0-9_-]{16,128}$/

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
  const paymentPayload = await client.createPaymentPayload(input.paymentRequired)
  return appendPaymentIdentifier(paymentPayload, input.idempotencyKey)
}

export function appendPaymentIdentifier(paymentPayload: PaymentPayload, paymentId: string): PaymentPayload {
  const extension = paymentPayload.extensions?.['payment-identifier']
  if (!isPaymentIdentifierExtension(extension)) return paymentPayload
  if (!paymentIdentifierPattern.test(paymentId)) {
    throw new Error('Payment identifier must be 16-128 characters using letters, digits, hyphens, or underscores.')
  }
  return {
    ...paymentPayload,
    extensions: {
      ...paymentPayload.extensions,
      'payment-identifier': {
        ...extension,
        info: {
          ...extension.info,
          id: paymentId,
        },
      },
    },
  }
}

function isPaymentIdentifierExtension(
  extension: unknown,
): extension is Record<string, unknown> & { info: Record<string, unknown> & { required: boolean } } {
  if (!extension || typeof extension !== 'object') return false
  const info = (extension as Record<string, unknown>).info
  return Boolean(info && typeof info === 'object' && typeof (info as Record<string, unknown>).required === 'boolean')
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
  requireCdpSignerConfig(env)
  return {
    address: input.address,
    async signTypedData(typedData) {
      const cdp = createCdpClient(env)
      try {
        const result = await cdp.endUser.signEvmTypedData({
          userId: input.cdpUserId,
          address: input.address,
          typedData: withExplicitEip712Domain(typedData),
          idempotencyKey: input.idempotencyKey,
          projectId: env.CDP_PROJECT_ID,
        })
        return result.signature as `0x${string}`
      } catch (error) {
        if (isInactiveDelegationError(error)) {
          throw forbidden(
            'CDP signing delegation is inactive. Re-authorize the Wallet and retry with a new idempotency key.',
          )
        }
        throw error
      }
    },
  }
}

export function requireCdpSignerConfig(env: Env) {
  if (
    !env.CDP_API_KEY_ID ||
    !env.CDP_API_KEY_SECRET ||
    !env.CDP_WALLET_SECRET ||
    !env.CDP_PROJECT_ID
  ) {
    throw new Error('CDP server credentials and project ID are not configured.')
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
