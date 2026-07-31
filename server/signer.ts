import type { PaymentRequired, WalletAccount } from '../shared/contracts'
import { createCdpClient } from './cdp'
import { walletNetworkDefinition, walletNetworkRpcUrl } from './network'
import { x402Client } from '@x402/core/client'
import type { ClientEvmSigner } from '@x402/evm'
import { registerExactEvmScheme } from '@x402/evm/exact/client'
import { ExactSvmScheme, type ClientSvmSigner } from '@x402/svm'
import {
  address,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  type SignatureBytes,
} from '@solana/kit'
import { privateKeyToAccount } from 'viem/accounts'

interface WalletSignerInput {
  cdpUserId: string
  account: WalletAccount
  network: string
  paymentRequired: PaymentRequired
  idempotencyKey: string
}

export async function createX402Payment(env: Env, input: WalletSignerInput) {
  const definition = walletNetworkDefinition(input.network)
  const client = new x402Client()
  if (definition.family === 'evm') {
    registerExactEvmScheme(client, {
      signer: createEvmSigner(env, input),
      networks: [definition.id],
    })
  } else {
    client.register(
      definition.id,
      new ExactSvmScheme(createSolanaSigner(env, input), {
        rpcUrl: walletNetworkRpcUrl(env, definition.id),
      }),
    )
  }
  return client.createPaymentPayload(input.paymentRequired)
}

function createEvmSigner(env: Env, input: WalletSignerInput): ClientEvmSigner {
  const walletAddress = input.account.address as `0x${string}`
  if (env.SIGNER_MODE === 'mock') {
    if (!env.MOCK_SIGNER_PRIVATE_KEY) {
      throw new Error('MOCK_SIGNER_PRIVATE_KEY is required in mock signer mode.')
    }
    const account = privateKeyToAccount(env.MOCK_SIGNER_PRIVATE_KEY as `0x${string}`)
    if (account.address.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new Error('Configured mock signer does not match the Wallet address.')
    }
    return account
  }
  return {
    address: walletAddress,
    async signTypedData(typedData) {
      const result = await createCdpClient(env).endUser.signEvmTypedData({
        userId: input.cdpUserId,
        address: walletAddress,
        typedData: withExplicitEip712Domain(typedData),
        idempotencyKey: input.idempotencyKey,
      })
      return result.signature as `0x${string}`
    },
  }
}

function createSolanaSigner(env: Env, input: WalletSignerInput): ClientSvmSigner {
  const signerAddress = address(input.account.address)
  return {
    address: signerAddress,
    async signTransactions(transactions) {
      return Promise.all(
        transactions.map(async (transaction, index) => {
          if (env.SIGNER_MODE === 'mock') {
            return { [signerAddress]: mockSolanaSignature(index) }
          }
          const encoded = getBase64EncodedWireTransaction(transaction)
          const result = await createCdpClient(env).endUser.signSolanaTransaction({
            userId: input.cdpUserId,
            address: input.account.address,
            transaction: encoded,
            idempotencyKey: `${input.idempotencyKey}-${index}`,
          })
          const signed = getTransactionDecoder().decode(decodeBase64(result.signedTransaction))
          const signature = signed.signatures[signerAddress]
          if (!signature) throw new Error('CDP did not return the Solana account signature.')
          return { [signerAddress]: signature }
        }),
      )
    },
  }
}

function mockSolanaSignature(index: number) {
  const bytes = new Uint8Array(64)
  bytes.fill((index % 254) + 1)
  return bytes as SignatureBytes
}

function decodeBase64(value: string) {
  const decoded = atob(value)
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
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
