import type { FaucetRequest, WalletRuntime, WalletUser } from '../shared/contracts'
import { ApiError, badRequest, forbidden, upstreamError } from './errors'
import { cdpNetwork, walletNetwork } from './network'
import { CdpClient } from '@coinbase/cdp-sdk'
import { getDefaultAsset } from '@x402/evm'

const nativeAssetAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export async function verifyWalletRegistration(
  env: Env,
  input: { cdpUserId: string; address: string; oidcSubject: string },
) {
  if (env.SIGNER_MODE === 'mock') {
    return { delegationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() }
  }

  const cdp = createCdpClient(env)
  try {
    const endUser = await cdp.endUser.getEndUser({ userId: input.cdpUserId })
    const matchingIdentity = hasMatchingDeveloperJwtIdentity(
      endUser.authenticationMethods,
      input.oidcSubject,
    )
    if (!matchingIdentity) {
      throw badRequest('The CDP end user is not bound to the current OIDC subject.')
    }
    const ownsAddress = endUser.evmAccountObjects.some(
      (account) => account.address.toLowerCase() === input.address.toLowerCase(),
    )
    if (!ownsAddress) throw badRequest('The EVM account does not belong to this CDP end user.')
    const delegation = await cdp.endUser.getDelegationForEndUser({
      userId: input.cdpUserId,
      projectId: env.CDP_PROJECT_ID,
    })
    if (new Date(delegation.expiresAt).getTime() <= Date.now()) {
      throw badRequest('The CDP signing delegation is already expired.')
    }
    return { delegationExpiresAt: delegation.expiresAt }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw upstreamError('CDP could not verify the Wallet account and signing delegation.')
  }
}

export function hasMatchingDeveloperJwtIdentity(
  methods: Array<{ type: string; sub?: string }>,
  oidcSubject: string,
) {
  return methods.some((method) => method.type === 'jwt' && method.sub === oidcSubject)
}

export async function getWalletRuntime(env: Env, user: WalletUser): Promise<{
  runtime: WalletRuntime
  delegationExpiresAt?: string | null
}> {
  if (!user.walletAddress || !user.cdpUserId) {
    return {
      runtime: {
        balances: [],
        balanceStatus: 'available',
        faucetAvailable: env.WALLET_NETWORK === 'eip155:84532',
      },
    }
  }

  if (env.SIGNER_MODE === 'mock') {
    return {
      runtime: {
        balances: [
          { symbol: 'USDC', amount: '0', decimals: 6, contractAddress: walletAsset(env).address },
          { symbol: 'ETH', amount: '0', decimals: 18, contractAddress: null },
        ],
        balanceStatus: 'available',
        faucetAvailable: false,
      },
    }
  }

  const cdp = createCdpClient(env)
  const cdpUserId = user.cdpUserId
  try {
    const [balances, delegation] = await Promise.all([
      cdp.evm.listTokenBalances({
        address: user.walletAddress as `0x${string}`,
        network: cdpNetwork(env.WALLET_NETWORK),
        pageSize: 100,
      }),
      activeDelegationOrNull(() =>
        cdp.endUser.getDelegationForEndUser({
          userId: cdpUserId,
          projectId: env.CDP_PROJECT_ID,
        }),
      ),
    ])
    const asset = walletAsset(env)
    const usdc = balances.balances.find(
      (balance) => balance.token.contractAddress.toLowerCase() === asset.address.toLowerCase(),
    )
    const native = balances.balances.find(
      (balance) => balance.token.contractAddress.toLowerCase() === nativeAssetAddress,
    )
    return {
      runtime: {
        balances: [
          {
            symbol: 'USDC',
            amount: usdc?.amount.amount.toString() ?? '0',
            decimals: usdc?.amount.decimals ?? asset.decimals,
            contractAddress: asset.address,
          },
          {
            symbol: native?.token.symbol ?? 'ETH',
            amount: native?.amount.amount.toString() ?? '0',
            decimals: native?.amount.decimals ?? 18,
            contractAddress: null,
          },
        ],
        balanceStatus: 'available',
        faucetAvailable: env.WALLET_NETWORK === 'eip155:84532',
      },
      delegationExpiresAt: delegation?.expiresAt ?? null,
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'wallet runtime lookup failed',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return {
      runtime: {
        balances: [],
        balanceStatus: 'unavailable',
        faucetAvailable: env.WALLET_NETWORK === 'eip155:84532',
      },
    }
  }
}

export async function requestTestnetFunds(env: Env, user: WalletUser, input: FaucetRequest) {
  if (env.SIGNER_MODE === 'mock') throw forbidden('The faucet is unavailable in mock signer mode.')
  if (env.WALLET_NETWORK !== 'eip155:84532') {
    throw forbidden('Testnet funding is only available on Base Sepolia.')
  }
  if (!user.walletAddress) throw badRequest('Provision a Wallet before requesting testnet funds.')

  try {
    return await createCdpClient(env).evm.requestFaucet({
      address: user.walletAddress,
      network: 'base-sepolia',
      token: input.token,
      idempotencyKey: crypto.randomUUID(),
    })
  } catch {
    throw upstreamError('The CDP faucet request failed or is currently rate limited.')
  }
}

export function walletAsset(env: Env) {
  const network = walletNetwork(env.WALLET_NETWORK)
  const asset = getDefaultAsset(network)
  return {
    address: asset.address,
    symbol: 'USDC',
    decimals: asset.decimals,
  }
}

export function createCdpClient(env: Env) {
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET || !env.CDP_WALLET_SECRET) {
    throw new Error('CDP server credentials are not configured.')
  }
  return new CdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    walletSecret: env.CDP_WALLET_SECRET,
  })
}

export function isInactiveDelegationError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: unknown; errorType?: unknown }
  return candidate.statusCode === 403 && candidate.errorType === 'delegation_not_found'
}

export async function activeDelegationOrNull<T>(lookup: () => Promise<T>) {
  try {
    return await lookup()
  } catch (error) {
    if (isInactiveDelegationError(error)) return null
    throw error
  }
}
