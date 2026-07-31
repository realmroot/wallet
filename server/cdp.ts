import type {
  FaucetRequest,
  UpdateWalletInput,
  WalletAccount,
  WalletRuntime,
  WalletUser,
} from '../shared/contracts'
import { ApiError, badRequest, forbidden, upstreamError } from './errors'
import {
  cdpEvmNetwork,
  walletNetworkDefinition,
  walletNetworkRpcUrl,
} from './network'
import { CdpClient } from '@coinbase/cdp-sdk'
import { createPublicClient, erc20Abi, http } from 'viem'

export async function verifyWalletRegistration(
  env: Env,
  input: UpdateWalletInput & { oidcSubject: string },
) {
  validateAccountFamilies(input.accounts)
  if (env.SIGNER_MODE === 'mock') {
    const delegationExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    return {
      accounts: input.accounts.map((account) => ({ ...account, delegationExpiresAt })),
    }
  }

  const cdp = createCdpClient(env)
  try {
    const endUser = await cdp.endUser.getEndUser({ userId: input.cdpUserId })
    if (!hasMatchingDeveloperJwtIdentity(endUser.authenticationMethods, input.oidcSubject)) {
      throw badRequest('The CDP end user is not bound to the current OIDC subject.')
    }
    for (const account of input.accounts) {
      const owned =
        account.family === 'evm'
          ? endUser.evmAccountObjects.some(
              (candidate) => candidate.address.toLowerCase() === account.address.toLowerCase(),
            )
          : endUser.solanaAccountObjects.some((candidate) => candidate.address === account.address)
      if (!owned) {
        throw badRequest(`The ${account.family === 'evm' ? 'EVM' : 'Solana'} account does not belong to this CDP end user.`)
      }
    }
    const delegation = await cdp.endUser.getDelegationForEndUser({
      userId: input.cdpUserId,
      projectId: env.CDP_PROJECT_ID,
    })
    if (new Date(delegation.expiresAt).getTime() <= Date.now()) {
      throw badRequest('The CDP signing delegation is already expired.')
    }
    return {
      accounts: input.accounts.map((account) => ({
        ...account,
        delegationExpiresAt: delegation.expiresAt,
      })),
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw upstreamError('CDP could not verify the Wallet accounts and signing delegation.')
  }
}

export function hasMatchingDeveloperJwtIdentity(
  methods: Array<{ type: string; sub?: string }>,
  oidcSubject: string,
) {
  return methods.some((method) => method.type === 'jwt' && method.sub === oidcSubject)
}

export async function getWalletRuntime(
  env: Env,
  user: WalletUser,
  network: string,
): Promise<WalletRuntime> {
  const definition = walletNetworkDefinition(network)
  const account = user.accounts.find((candidate) => candidate.family === definition.family) ?? null
  const unavailable = (balanceStatus: WalletRuntime['balanceStatus']): WalletRuntime => ({
    network: definition.id,
    family: definition.family,
    account,
    balances: [],
    balanceStatus,
    faucetAssets: [...definition.faucetAssets],
  })
  if (!account || !user.cdpUserId) {
    return unavailable('available')
  }
  if (env.SIGNER_MODE === 'mock') {
    return {
      network: definition.id,
      family: definition.family,
      account,
      balances: [
        {
          symbol: 'USDC',
          amount: '0',
          decimals: definition.asset.decimals,
          assetAddress: definition.asset.address,
        },
        {
          symbol: definition.nativeSymbol,
          amount: '0',
          decimals: definition.family === 'solana' ? 9 : 18,
          assetAddress: null,
        },
      ],
      balanceStatus: 'available',
      faucetAssets: [],
    }
  }

  try {
    const balances =
      definition.family === 'evm'
        ? await getEvmBalances(env, account, definition.id)
        : await getSolanaBalances(env, account, definition.id)
    return {
      network: definition.id,
      family: definition.family,
      account,
      balances,
      balanceStatus: 'available',
      faucetAssets: [...definition.faucetAssets],
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'wallet runtime lookup failed',
        userId: user.id,
        network: definition.id,
        family: definition.family,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return unavailable('unavailable')
  }
}

export async function getWalletDelegationExpiry(env: Env, user: WalletUser) {
  if (env.SIGNER_MODE === 'mock' || !user.cdpUserId || user.accounts.length === 0) return undefined
  try {
    return await currentDelegationExpiry(env, user.cdpUserId)
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'wallet delegation lookup failed',
        userId: user.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return undefined
  }
}

export async function requestTestnetFunds(
  env: Env,
  user: WalletUser,
  input: FaucetRequest,
) {
  if (env.SIGNER_MODE === 'mock') throw forbidden('The faucet is unavailable in mock signer mode.')
  const definition = walletNetworkDefinition(input.network)
  if (!definition.faucetAssets.includes(input.asset)) {
    throw forbidden(`The ${definition.name} faucet does not provide this asset.`)
  }
  const account = user.accounts.find((candidate) => candidate.family === definition.family)
  if (!account) throw badRequest(`Provision a ${definition.family === 'evm' ? 'EVM' : 'Solana'} account first.`)

  try {
    if (definition.family === 'evm') {
      const result = await createCdpClient(env).evm.requestFaucet({
        address: account.address as `0x${string}`,
        network: cdpEvmNetwork(definition.id) as 'base-sepolia',
        token: input.asset === 'native' ? 'eth' : 'usdc',
        idempotencyKey: crypto.randomUUID(),
      })
      return { transactionHash: result.transactionHash }
    }
    const result = await createCdpClient(env).solana.requestFaucet({
      address: account.address,
      token: input.asset === 'native' ? 'sol' : 'usdc',
      idempotencyKey: crypto.randomUUID(),
    })
    return { transactionHash: result.signature }
  } catch {
    throw upstreamError('The CDP faucet request failed or is currently rate limited.')
  }
}

export function walletAsset(network: string) {
  return walletNetworkDefinition(network).asset
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

async function getEvmBalances(env: Env, account: WalletAccount, network: string) {
  const definition = walletNetworkDefinition(network)
  const client = createPublicClient({
    chain: undefined,
    transport: http(walletNetworkRpcUrl(env, network)),
  })
  const [usdc, native] = await Promise.all([
    client.readContract({
      address: definition.asset.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address as `0x${string}`],
    }),
    client.getBalance({ address: account.address as `0x${string}` }),
  ])
  return [
    {
      symbol: 'USDC',
      amount: usdc.toString(),
      decimals: definition.asset.decimals,
      assetAddress: definition.asset.address,
    },
    {
      symbol: definition.nativeSymbol,
      amount: native.toString(),
      decimals: 18,
      assetAddress: null,
    },
  ]
}

async function getSolanaBalances(env: Env, account: WalletAccount, network: string) {
  const definition = walletNetworkDefinition(network)
  const rpcUrl = walletNetworkRpcUrl(env, network)
  const [native, tokens] = await Promise.all([
    solanaRpc<{ value: number }>(rpcUrl, 'getBalance', [account.address, { commitment: 'confirmed' }]),
    solanaRpc<{
      value: Array<{
        account: {
          data: {
            parsed: { info: { tokenAmount: { amount: string }; mint: string } }
          }
        }
      }>
    }>(rpcUrl, 'getTokenAccountsByOwner', [
      account.address,
      { mint: definition.asset.address },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
  ])
  const amount = tokens.value.reduce(
    (total, item) => total + BigInt(item.account.data.parsed.info.tokenAmount.amount),
    0n,
  )
  return [
    {
      symbol: 'USDC',
      amount: amount.toString(),
      decimals: definition.asset.decimals,
      assetAddress: definition.asset.address,
    },
    {
      symbol: definition.nativeSymbol,
      amount: String(native.value),
      decimals: 9,
      assetAddress: null,
    },
  ]
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

async function currentDelegationExpiry(env: Env, cdpUserId: string) {
  const delegation = await activeDelegationOrNull(() =>
    createCdpClient(env).endUser.getDelegationForEndUser({
      userId: cdpUserId,
      projectId: env.CDP_PROJECT_ID,
    }),
  )
  return delegation?.expiresAt ?? null
}

function validateAccountFamilies(accounts: UpdateWalletInput['accounts']) {
  for (const account of accounts) {
    if (account.family === 'evm' && !account.address.startsWith('0x')) {
      throw badRequest('The EVM account address is invalid.')
    }
    if (account.family === 'solana' && account.address.startsWith('0x')) {
      throw badRequest('The Solana account address is invalid.')
    }
  }
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
