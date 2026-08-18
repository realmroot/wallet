import { env, SELF } from 'cloudflare:test'
import type { PaymentRequired, UpdateWalletInput } from '../shared/contracts'
import { cleanupExpiredReservations } from '../server/repository'
import {
  hasMatchingDeveloperJwtIdentity,
  isInactiveDelegationError,
  walletAsset,
} from '../server/cdp'
import {
  hasMatchingSolanaTransfer,
  hasMatchingUsdcTransfer,
  verifySettlement,
} from '../server/settlement'
import { walletNetworkDefinition, walletNetworkIds, walletNetworks } from '../server/network'
import {
  appendPaymentIdentifier,
  requireCdpSignerConfig,
  withExplicitEip712Domain,
} from '../server/signer'
import { paymentRequiredSchema } from '../shared/contracts'
import { buildAgentWallet } from '../server/agent-wallet'
import { walletBindings } from '../server/runtime-config'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { getDefaultAsset } from '@x402/evm'
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const humanIssuer = 'https://fa.test/api/auth'
const agentIssuer = humanIssuer
const audience = 'https://wallet.test/api'
const walletUrl = 'https://wallet.test/api/x402/payments'
const budgetRequestsUrl = 'https://wallet.test/api/agent/budget-requests'
const agentWalletUrl = 'https://wallet.test/api/agent/wallet'
const ownerSubject = 'user-1'
const agentSubject = 'agent-1'
const mockSignerPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const walletAddress = privateKeyToAccount(mockSignerPrivateKey).address

afterEach(() => vi.restoreAllMocks())

let humanPrivateKey: CryptoKey
let humanPublicJwk: JsonWebKey
let agentPrivateKey: CryptoKey
let agentPublicJwk: JsonWebKey
let dpopPrivateKey: CryptoKey
let dpopPublicJwk: JsonWebKey

beforeAll(async () => {
  humanPrivateKey = (await importJWK({
    kty: 'EC',
    x: 'MILFoz663spK7Wqv4RYXxwuzKL8cjKMulu_uC09AF2Q',
    y: 'e95GZitNto3GcOKOUE7mi5n6w6y9CEVy6opDBb3ew5k',
    crv: 'P-256',
    d: 'yimeNBrA8cn1voMvauW2TqpoKSwr-yPj9jHBGajfwyw',
    kid: 'human',
  }, 'ES256')) as CryptoKey
  agentPrivateKey = (await importJWK({
    kty: 'RSA',
    n: 'lysCaEKG49Bz3GllXo_qpNTzs5RrZmDwxN9jgkLijtRaP0HGCcc80QY4zRAlgmVuq74cXYh4cEk7oyENx725fDbDt4b7ZqFhv6atkO1m2pf33tweXr2OhKIOVpf88vAQjSHVSOm9v-rI8SlJQrSvHIBQVta-IWtMy3kbOy_Ws_W2y7NpsryckQg-fRj2laKu128FNP2-xP1-4f6Bw0DFVAlMGRF2UG8hCOgJ0lNuCfaukunxRy-APcIWuYhZDM7Z6XPE-mGGNtosUfuQBLTkk0g7OoGodhNRO0hCcKaZlliCZlRlZcPYTS0pSwFeFuZoyVjo75UtCC-kRRnaXzT7fQ',
    e: 'AQAB',
    d: 'FmbZRHoXY0tQ4Cj-TLUnIKYuNz6Xa-SRyZsRNAyVZnUxqo4kuu47pP43DKyH4nsFm43gxjujHYC8xb_wOtly02WKO3hVaTAhPDWHIyMLSvmaUfxsw71zkVQyq8J6ScYprcCFyvhYlkhE3vgvUyNTj_Wz8iqAopM0HjMkRfEg8CoPSO-dIs4wQg8RAETmMFspbmq_MZs0H3K_0_V7aSZ0V4pX_CiDJM4e8dnAfJHzy1S5klpHodoQ9irdYBN_8B6zfcfeRynH91ag3vwFnIyl2M4TpcRkwstJXyVwksC4LUCBRSBIJw00JN_SljMNyTMt3eZPghZ1ND3AZKSkYBQ4QQ',
    p: 'yjPRqfDq_rKMoKnicwVM64dgjltKLQcNO_l8g9_sY0rkQZ5NU1xKASJWkKUNs5RjRirBsMdkvQ0fhoaB5c4qa8g7z09oeJfe1LOTOrahdLbvRmZ1ZBp2qXBkslrYZXIy-ujuilYX7s7Jvbf60IqqlQ70WBU1IMhY8FX9rDUsi4M',
    q: 'v2MxTI59L8lp0o-T-Ku2gbCGuZUavwKAhIYZ1ken9G8977z3m6TSyQWMWc0MyHLSHmoqGPT-JC9602PsuSi_U6cI0_Qk8BG73SoWZK8EnNgGzzEKuWnzNulJNgmKb6kwiJtNC15lm2p2M769EGNMgrlwcWwkY7DJ7aZv3sBerP8',
    dp: 'gGU9Omsn3UllcNPPXng8KscQ8fRX-pWiurWmclrrUPWKUXyC328X8vZp_3k_ZQvRqgmWanmCp2VA4nxg2Zr7ZuuDxxVGYmUVcv0AfWTgyysqbwq6ejEvrlIXLwXuqSRF6PumFSOsGNEoW5cK5gdXYEVZtODqloGBsEL6TLKLMZ8',
    dq: 'a14cZBRzyoE16rg9jP3X7z229xnc3Vdr_ey1Re8BHDHkD0B1sE1xKvD_4ckU6MbxdbqdT07x3B7-yuR-AwoG-8jzPOT0a_Gm8NYRpf5BmjPe7hFXMNltZlrNhZEopqfF4H0vZbdZTS0WjsTsj-sFGzkpCZhfecXOIpKCo_ZLpsU',
    qi: 'UTm7D4uOsMIUyZtPmp8wPPKE49gosFia4akqbpVeNh15xapi2cQUPOUgO5BgmbceZIV9Dxvoc6hNNs0VkJ56k3xdC1JvuWve2v1UgDxsCjJJoiYOsT7rc1HlY8UyEV2aBCWMQasfL5sviH3nHxThuPihWiRrBJL2iFqIRoHZBhs',
    kid: 'agent',
  }, 'RS256')) as CryptoKey

  const dpop = await generateKeyPair('ES256', { extractable: true })
  dpopPrivateKey = dpop.privateKey
  dpopPublicJwk = await exportJWK(dpop.publicKey)
})

describe('Agent Wallet', () => {
  it('adds the explicit EIP-712 domain type required by CDP delegated signing', () => {
    const typedData = withExplicitEip712Domain({
      domain: {
        name: 'USD Coin',
        version: '2',
        chainId: 84532,
        verifyingContract: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: walletAddress,
        to: '0x0000000000000000000000000000000000000001',
      },
    })

    expect(typedData.types.EIP712Domain).toEqual([
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ])
  })

  it('recognizes a revoked CDP signing delegation', () => {
    expect(
      isInactiveDelegationError({
        statusCode: 403,
        errorType: 'delegation_not_found',
      }),
    ).toBe(true)
    expect(
      isInactiveDelegationError({
        statusCode: 503,
        errorType: 'service_unavailable',
      }),
    ).toBe(false)
    expect(isInactiveDelegationError(new Error('Delegation failed.'))).toBe(false)
  })

  it('requires a CDP project ID for custom-auth delegated signing', () => {
    const credentials = {
      CDP_API_KEY_ID: 'key-id',
      CDP_API_KEY_SECRET: 'key-secret',
      CDP_WALLET_SECRET: 'wallet-secret',
    } as Env
    expect(() => requireCdpSignerConfig(credentials)).toThrow(
      'CDP server credentials and project ID are not configured.',
    )
    expect(() =>
      requireCdpSignerConfig({
        ...credentials,
        CDP_PROJECT_ID: 'project-id',
      }),
    ).not.toThrow()
  })

  it('binds CDP users to the current OIDC subject', () => {
    const methods = [
      { type: 'jwt', sub: ownerSubject },
      { type: 'email', sub: 'not-used' },
    ]
    expect(hasMatchingDeveloperJwtIdentity(methods, ownerSubject)).toBe(true)
    expect(hasMatchingDeveloperJwtIdentity(methods, 'attacker')).toBe(false)
  })

  it('matches the exact USDC settlement transfer', () => {
    const payTo = '0x0000000000000000000000000000000000000001'
    const asset = getDefaultAsset('eip155:84532').address
    const log = {
      address: asset,
      topics: encodeEventTopics({
        abi: erc20Abi,
        eventName: 'Transfer',
        args: { from: walletAddress, to: payTo },
      }),
      data: encodeAbiParameters([{ type: 'uint256' }], [25_000n]),
    }
    const payment = {
      asset,
      amount: '25000',
      pay_to: payTo,
      wallet_address: walletAddress,
    }
    expect(hasMatchingUsdcTransfer([log], payment)).toBe(true)
    expect(hasMatchingUsdcTransfer([log], { ...payment, amount: '25001' })).toBe(false)
  })

  it('matches a confirmed Solana USDC balance transfer', () => {
    const payer = '7YttLkHDoGfW4jz1F8JvM5KQbQfRYW3uBVJcQe6pRX8F'
    const payTo = '9aZQ3xgH7SxKpwT4krGjQJY4B9u4Ah7d7yJxLwFxS5JH'
    const mint = walletNetworkDefinition(
      'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    ).asset.address
    const transaction = {
      meta: {
        err: null,
        preTokenBalances: [
          { accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: '100000' } },
          { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: '1000' } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint, owner: payer, uiTokenAmount: { amount: '75000' } },
          { accountIndex: 2, mint, owner: payTo, uiTokenAmount: { amount: '26000' } },
        ],
      },
    }
    const payment = {
      asset: mint,
      amount: '25000',
      pay_to: payTo,
      wallet_address: payer,
    }
    expect(hasMatchingSolanaTransfer(transaction, payment)).toBe(true)
    expect(hasMatchingSolanaTransfer(transaction, { ...payment, amount: '25001' })).toBe(false)
  })

  it('reports an unconfirmed settlement as retryable instead of an upstream failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
        headers: { 'content-type': 'application/json' },
      }),
    )

    await expect(
      verifySettlement(
        { ...env, SIGNER_MODE: 'cdp' } as unknown as Env,
        {
          asset: getDefaultAsset('eip155:84532').address,
          amount: '25000',
          network: 'eip155:84532',
          pay_to: '0x0000000000000000000000000000000000000001',
          status: 'signed',
          transaction_hash: null,
          wallet_address: walletAddress,
        },
        {
          success: true,
          payer: walletAddress,
          transaction: `0x${'ab'.repeat(32)}`,
          network: 'eip155:84532',
        },
      ),
    ).rejects.toMatchObject({
      status: 425,
      code: 'settlement_pending',
      headers: { 'Retry-After': '3' },
    })
  })

  it('registers mainnet and Sandbox networks in one Wallet service', () => {
    expect(walletNetworks(walletBindings(env)).map((network) => network.id)).toEqual(walletNetworkIds)
    expect(walletNetworkDefinition('eip155:8453').mode).toBe('production')
    expect(walletNetworkDefinition('eip155:84532').mode).toBe('sandbox')
    expect(walletNetworkDefinition('eip155:4801').asset.address).toBe(
      '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
    )
    expect(
      walletNetworkDefinition('solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1').asset.address,
    ).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
  })

  it('calculates the maximum amount the current Agent can pay', () => {
    const wallet = buildAgentWallet(
      walletBindings(env),
      {
        id: 'user-1',
        issuer: humanIssuer,
        subject: ownerSubject,
        email: null,
        cdpUserId: 'cdp-user-1',
        accounts: [{
          id: crypto.randomUUID(),
          family: 'evm',
          address: walletAddress,
          delegationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        }],
        pausedAt: null,
      },
      [{
        id: 'grant-1',
        agentIssuer,
        agentSubject,
        mode: 'sandbox',
        totalLimit: '100000',
        spentTotal: '20000',
        perTransactionLimit: '50000',
        periodKind: 'daily',
        periodLimit: '40000',
        periodSpent: '15000',
        allowedOrigins: [],
        allowedRecipients: [],
        expiresAt: null,
        pausedAt: null,
      }],
      [{
        network: 'eip155:84532',
        family: 'evm',
        account: {
          id: crypto.randomUUID(),
          family: 'evm',
          address: walletAddress,
          delegationExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        balances: [
          {
            symbol: 'USDC',
            amount: '30000',
            decimals: 6,
            assetAddress: getDefaultAsset('eip155:84532').address,
          },
        ],
        balanceStatus: 'available',
        faucetAssets: [],
      }],
    )

    const sandboxNetwork = wallet.networks.find((network) => network.network === 'eip155:84532')
    expect(sandboxNetwork?.payment).toEqual({
      ready: true,
      maximumAmount: '25000',
      blockers: [],
    })
    expect(wallet.budgets[0]?.remaining.total).toBe('80000')
    expect(wallet.budgets[0]?.remaining.period).toBe('25000')
  })

  it('uses the canonical USDC asset for Base Mainnet and Base Sepolia', () => {
    expect(walletAsset('eip155:8453').address).toBe(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    )
    expect(walletAsset('eip155:84532').address).toBe(
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    )
  })

  it('reports deployment readiness', async () => {
    const response = await SELF.fetch('https://wallet.test/readyz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  it('publishes a Restish-discoverable x402 payer contract', async () => {
    const discovery = await SELF.fetch('https://wallet.test/api/openapi.json')
    expect(discovery.status).toBe(200)
    expect(discovery.headers.get('link')).toContain('rel="service-desc"')
    expect(await discovery.json()).toMatchObject({
      servers: [{ url: '.' }],
      components: {
        securitySchemes: {
          RealmrootOAuth: {
            type: 'oauth2',
            'x-dpop-required': true,
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://fa.test/api/auth/oauth2/authorize',
                tokenUrl: 'https://fa.test/api/auth/oauth2/token',
                scopes: {
                  'wallet:read': expect.any(String),
                  'wallet:manage': expect.any(String),
                  'wallet:budget:request': expect.any(String),
                  'wallet:x402:pay': expect.any(String),
                },
              },
            },
          },
        },
      },
      paths: {
        '/agent/wallet': {
          get: {
            operationId: 'getAgentWallet',
            tags: ['wallet'],
            'x-cli-name': 'show',
            security: [{ RealmrootOAuth: ['wallet:read'] }],
          },
        },
        '/agent/budget-requests': {
          post: {
            security: [{ RealmrootOAuth: ['wallet:budget:request'] }],
          },
        },
        '/agent/budget-requests/{requestId}': {
          get: {
            security: [{ RealmrootOAuth: ['wallet:budget:request'] }],
          },
        },
        '/x402/payments': {
          post: {
            operationId: 'createPaymentAuthorization',
            tags: ['payment'],
            'x-cli-name': 'authorize',
            security: [{ RealmrootOAuth: ['wallet:x402:pay'] }],
          },
        },
        '/x402/payments/{paymentId}': {
          get: {
            operationId: 'getPayment',
            tags: ['payment'],
            'x-cli-name': 'status',
            security: [{ RealmrootOAuth: ['wallet:x402:pay'] }],
          },
        },
        '/x402/payments/{paymentId}/settlement': {
          put: {
            operationId: 'confirmPaymentSettlement',
            tags: ['payment'],
            'x-cli-name': 'confirm',
            security: [{ RealmrootOAuth: ['wallet:x402:pay'] }],
          },
        },
      },
    })

    const root = await SELF.fetch('https://wallet.test/api')
    expect(root.status).toBe(200)
    expect(root.headers.get('link')).toContain('https://wallet.test/api/openapi.json')
    expect(root.headers.get('link')).toContain(
      '<https://wallet.test/api/workflows.arazzo.json>; rel="describedby"; type="application/vnd.oai.workflows+json"',
    )
    expect(root.headers.get('x-request-id')).toBeTruthy()
    expect(await root.json()).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/x402/payments': {
          post: {
            operationId: 'createPaymentAuthorization',
            responses: {
              400: {
                description:
                  'The x402 requirement is invalid or its Solana recipient is not initialized on-chain.',
              },
            },
          },
        },
      },
    })

    const contract = await SELF.fetch('https://wallet.test/api/openapi.json')
    expect(contract.status).toBe(200)
    const document = await contract.json<{
      paths: Record<string, unknown>
    }>()
    expect(document).toMatchObject({
      openapi: '3.1.0',
      externalDocs: {
        description: 'Machine-readable API workflows (Arazzo 1.1)',
        url: '/workflows.arazzo.json',
      },
      'x-x402': {
        role: 'payer',
        paymentOperationId: 'createPaymentAuthorization',
        settlementOperationId: 'confirmPaymentSettlement',
        headers: {
          paymentRequired: 'PAYMENT-REQUIRED',
          paymentSelection: 'PAYMENT-SELECTION',
          paymentSignature: 'PAYMENT-SIGNATURE',
          paymentResponse: 'PAYMENT-RESPONSE',
        },
      },
      paths: {
        '/x402/payments': {
          post: { operationId: 'createPaymentAuthorization' },
        },
        '/x402/payments/{paymentId}': {
          get: { operationId: 'getPayment' },
        },
        '/x402/payments/{paymentId}/settlement': {
          put: { operationId: 'confirmPaymentSettlement' },
        },
      },
      components: {
        schemas: {
          AgentWallet: {
            properties: {
              networks: {
                items: {
                  properties: {
                    network: {
                      enum: walletNetworkIds,
                      example: 'eip155:8453',
                    },
                  },
                },
              },
            },
          },
          AgentPayment: {
            properties: {
              network: {
                enum: walletNetworkIds,
                example: 'eip155:8453',
              },
            },
          },
          PaymentRequirementProblem: {
            properties: {
              options: {
                items: {
                  properties: {
                    requirement: {
                      properties: {
                        network: {
                          enum: walletNetworkIds,
                          example: 'eip155:8453',
                        },
                        payTo: {
                          description:
                            'Merchant recipient. On Solana, this address must already exist on the selected network.',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          PaymentResult: {
            properties: {
              paymentPayload: {
                properties: {
                  accepted: {
                    properties: {
                      network: {
                        enum: walletNetworkIds,
                        example: 'eip155:8453',
                      },
                    },
                  },
                },
              },
            },
          },
          SettlementResponse: {
            properties: {
              network: {
                enum: walletNetworkIds,
                example: 'eip155:8453',
              },
            },
          },
        },
      },
    })

    const workflowResponse = await SELF.fetch('https://wallet.test/api/workflows.arazzo.json')
    expect(workflowResponse.status).toBe(200)
    expect(workflowResponse.headers.get('content-type')).toBe(
      'application/vnd.oai.workflows+json; version=1.1.0',
    )
    const workflows = await workflowResponse.json<{
      arazzo: string
      $self: string
      sourceDescriptions: Array<{ name: string; url: string; type: string }>
      workflows: Array<{
        workflowId: string
        steps: Array<{
          operationId: string
          parameters?: Array<{ name: string; in: string; value: string }>
          outputs?: Record<string, string>
        }>
      }>
    }>()
    expect(workflows).toMatchObject({
      arazzo: '1.1.0',
      $self: 'https://wallet.test/api/workflows.arazzo.json',
      sourceDescriptions: [{ name: 'payer', url: './openapi.json', type: 'openapi' }],
    })
    expect(workflows.workflows.map((workflow) => workflow.workflowId)).toEqual([
      'authorizeX402Payment',
      'authorizeSelectedX402Payment',
      'confirmX402Payment',
    ])
    expect(
      workflows.workflows.flatMap((workflow) => workflow.steps).map((step) => step.operationId),
    ).toEqual([
      'createPaymentAuthorization',
      'createPaymentAuthorization',
      'confirmPaymentSettlement',
      'getPayment',
    ])
    expect(workflows.workflows[0]?.steps[0]?.outputs?.paymentSignature).toBe(
      '$response.header.PAYMENT-SIGNATURE',
    )
    const paymentOperation = (document.paths['/x402/payments'] as {
      post: {
        requestBody?: unknown
        parameters: Array<{ name: string; in: string; required?: boolean }>
        responses: Record<string, { content?: Record<string, unknown> }>
      }
    }).post
    expect(paymentOperation.requestBody).toBeUndefined()
    expect(paymentOperation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'payment-required', in: 'header', required: true }),
        expect.objectContaining({ name: 'payment-selection', in: 'header', required: false }),
      ]),
    )
    expect(paymentOperation.responses['422']?.content).toHaveProperty('application/problem+json')
    expect(Object.keys(document.paths).sort()).toEqual([
      '/agent/budget-requests',
      '/agent/budget-requests/{requestId}',
      '/agent/wallet',
      '/x402/payments',
      '/x402/payments/{paymentId}',
      '/x402/payments/{paymentId}/settlement',
    ])

    expect((await SELF.fetch('https://wallet.test/api/user-openapi.json')).status).toBe(404)

    const rootAlias = await SELF.fetch('https://wallet.test/openapi.json')
    expect(rootAlias.headers.get('content-type')).not.toContain('application/json')
  })

  it('publishes RFC 9728 metadata for the Wallet API resource', async () => {
    const response = await SELF.fetch(
      'https://wallet.test/.well-known/oauth-protected-resource/api',
      { headers: { origin: 'https://client.test' } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(await response.json()).toEqual({
      resource: 'https://wallet.test/api',
      authorization_servers: ['https://fa.test/api/auth'],
      scopes_supported: [
        'wallet:read',
        'wallet:budget:request',
        'wallet:x402:pay',
        'wallet:manage',
      ],
      bearer_methods_supported: ['header'],
      resource_name: 'Agent Wallet API',
      dpop_signing_alg_values_supported: ['ES256', 'EdDSA'],
    })

    expect(
      (await SELF.fetch('https://wallet.test/.well-known/oauth-protected-resource')).status,
    ).toBe(404)
  })

  it('advertises RFC 9728 metadata in authentication challenges', async () => {
    const metadataUrl =
      'https://wallet.test/.well-known/oauth-protected-resource/api'
    const humanResponse = await SELF.fetch('https://wallet.test/api/overview')
    expect(humanResponse.status).toBe(401)
    expect(humanResponse.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${metadataUrl}"`,
    )

    const agentResponse = await SELF.fetch(agentWalletUrl)
    expect(agentResponse.status).toBe(401)
    expect(agentResponse.headers.get('www-authenticate')).toContain(
      `resource_metadata="${metadataUrl}"`,
    )
    expect(agentResponse.headers.get('www-authenticate')).toContain('DPoP error="invalid_token"')
  })

  it('keeps Sandbox as a product view on the single Wallet API', async () => {
    const configResponse = await SELF.fetch('https://wallet.test/api/config')
    expect(configResponse.status).toBe(200)
    expect(await configResponse.json()).toMatchObject({
      appOrigin: 'https://wallet.test',
      appBaseUrl: 'https://wallet.test',
      audience: 'https://wallet.test/api',
      defaultNetwork: 'eip155:8453',
      networks: expect.arrayContaining([
        expect.objectContaining({ id: 'eip155:8453', mode: 'production', paymentsEnabled: false }),
        expect.objectContaining({ id: 'eip155:84532', mode: 'sandbox', paymentsEnabled: true }),
      ]),
    })

    expect((await SELF.fetch('https://wallet.test/api/sandbox')).status).toBe(404)
    expect((await SELF.fetch('https://wallet.test/api/sandbox/openapi.json')).status).toBe(404)
  })
  it('shows only the Wallet delegated to the current Agent', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const response = await SELF.fetch(agentWalletUrl, {
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, agentWalletUrl, 'GET'),
      },
    })

    expect(response.status, await response.clone().text()).toBe(200)
    const status = await response.json()
    expect(status).toMatchObject({
      budgets: [{
        mode: 'sandbox',
        limits: {
          total: '1000000',
          perPayment: '100000',
          period: {
            kind: 'daily',
            amount: '250000',
          },
        },
      }],
    })
    expect((status as { budgets: Array<Record<string, unknown>> }).budgets[0]).not.toHaveProperty('name')
    expect(
      (status as { networks: Array<{ network: string }> }).networks.find(
        (network) => network.network === 'eip155:84532',
      ),
    ).toMatchObject({
      delegation: { status: 'active' },
      payment: {
        ready: false,
        maximumAmount: '0',
        blockers: ['insufficient_funds'],
      },
    })
    expect(JSON.stringify(status)).not.toContain('cdp-user-1')
    expect(JSON.stringify(status)).not.toContain('owner@example.com')
    expect(JSON.stringify(status)).not.toContain(ownerSubject)
  })

  it('enforces least-privilege Agent scopes at runtime', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const readToken = await createAgentToken(true, ['wallet:read'])

    const walletResponse = await SELF.fetch(agentWalletUrl, {
      headers: {
        authorization: `DPoP ${readToken}`,
        dpop: await dpopProof(readToken, agentWalletUrl, 'GET'),
      },
    })
    expect(walletResponse.status).toBe(200)

    const paymentResponse = await pay(readToken, paymentRequired('25000'))
    expect(paymentResponse.status).toBe(403)
    expect(await paymentResponse.json()).toMatchObject({
      error: 'forbidden',
      message: 'The wallet:x402:pay scope is required.',
    })
    expect(paymentResponse.headers.get('www-authenticate')).toContain('insufficient_scope')
  })

  it('applies API security, CORS, body limits, and schema validation middleware', async () => {
    const config = await SELF.fetch('https://wallet.test/api/config', {
      headers: { origin: 'https://wallet.test' },
    })
    expect(config.status).toBe(200)
    expect(config.headers.get('access-control-allow-origin')).toBe('https://wallet.test')
    expect(config.headers.get('x-content-type-options')).toBe('nosniff')
    expect(config.headers.get('x-request-id')).toBeTruthy()

    const invalid = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({
      error: 'bad_request',
      message: 'Request validation failed.',
    })

    const oversized = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(65 * 1024) }),
    })
    expect(oversized.status).toBe(413)
    expect(await oversized.json()).toMatchObject({ error: 'payload_too_large' })
  })

  it('provisions a wallet and approves a budget requested by the payment operation', async () => {
    const token = await humanToken()

    const initial = await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(initial.status, await initial.clone().text()).toBe(200)
    expect((await initial.json<{ user: { subject: string } }>()).user.subject).toBe(ownerSubject)

    const provision = await SELF.fetch('https://wallet.test/api/wallet', {
      method: 'PUT',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({
        cdpUserId: 'cdp-user-1',
        accounts: [{ family: 'evm', address: walletAddress }],
      }),
    })
    expect(provision.status).toBe(204)

    const agentToken = await createAgentToken()
    const request = await pay(agentToken, paymentRequired('25000'))
    expect(request.status).toBe(202)
    expect(request.headers.get('location')).toMatch(
      /^https:\/\/wallet\.test\/api\/agent\/budget-requests\/[0-9a-f-]+$/,
    )
    expect(request.headers.get('retry-after')).toBe('3')
    expect(request.headers.get('link')).toContain(
      '<https://realmroot.dev/profiles/interactive-resource>; rel="profile"',
    )
    const pending = await request.json<{
      requestId: string
      id: string
      agentId: string
      budgetId: null
      status: string
      approvalUrl: string
      pollIntervalSeconds: number
      interaction: { type: string; status: string; url: string }
      links: { self: string }
    }>()
    expect(pending.status).toBe('pending')
    expect(pending.id).toBe(pending.requestId)
    expect(pending.agentId).toBe(agentSubject)
    expect(pending.budgetId).toBeNull()
    expect(pending.pollIntervalSeconds).toBe(3)
    expect(pending.approvalUrl).toContain('/authorize#request=')
    expect(pending.interaction).toMatchObject({
      type: 'user-approval',
      status: 'pending',
      url: pending.approvalUrl,
    })
    expect(pending.links.self).toBe(request.headers.get('location'))

    const decision = await approveBudget(token, pending)
    expect(decision.status, await decision.clone().text()).toBe(200)
    expect(await decision.json()).toMatchObject({ status: 'approved' })

    const status = await budgetStatus(agentToken, pending.requestId)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({
      requestId: pending.requestId,
      budgetId: expect.any(String),
      status: 'approved',
      interaction: { type: 'user-approval', status: 'completed' },
      links: { self: expect.stringContaining(`/agent/budget-requests/${pending.requestId}`) },
    })

    const existing = await createBudgetRequest(agentToken)
    expect(existing.status).toBe(200)
    expect(await existing.json()).toMatchObject({
      requestId: null,
      budgetId: expect.any(String),
      status: 'approved',
    })
  })

  it('turns a Base Sepolia x402 requirement into a signed payment under the Agent budget', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const requirement = paymentRequired('25000')

    const response = await pay(agentToken, requirement)
    expect(response.status).toBe(200)
    const body = await response.json<{
      paymentId: string
      paymentPayload: {
        accepted: { network: string; amount: string }
        payload: { signature: string; authorization: { from: string; value: string } }
      }
    }>()
    expect(body.paymentId).toBeTruthy()
    expect(body.paymentPayload.accepted).toMatchObject({
      network: 'eip155:84532',
      amount: '25000',
    })
    expect(body.paymentPayload.payload.signature).toMatch(/^0x[0-9a-f]+$/)
    expect(body.paymentPayload.payload.authorization.from.toLowerCase()).toBe(walletAddress.toLowerCase())
    expect(body.paymentPayload.payload.authorization.value).toBe('25000')

    const overview = await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
      headers: { authorization: `Bearer ${token}` },
    })
    const state = await overview.json<{
      grants: Array<{ spentTotal: string }>
      payments: Array<{ status: string }>
    }>()
    expect(state.grants[0]?.spentTotal).toBe('25000')
    expect(state.payments[0]?.status).toBe('signed')
  })

  it('charges Base and World payments against one cross-chain budget', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()

    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(200)
    expect(
      (
        await pay(
          agentToken,
          paymentRequiredForNetwork('30000', 'eip155:4801'),
        )
      ).status,
    ).toBe(200)

    const overview = await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
      headers: { authorization: `Bearer ${token}` },
    })
    const state = await overview.json<{
      grants: Array<{ spentTotal: string }>
      payments: Array<{ network: string }>
    }>()
    expect(state.grants[0]?.spentTotal).toBe('55000')
    expect(state.payments.map((payment) => payment.network)).toEqual([
      'eip155:4801',
      'eip155:84532',
    ])
  })

  it('keeps one Agent identity with independent Production and Sandbox budgets', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const productionRequest = await createBudgetRequest(agentToken, 'production')
    expect(productionRequest.status).toBe(201)
    const pending = await productionRequest.json<{ requestId: string; approvalUrl: string }>()
    expect((await approveBudget(token, pending)).status).toBe(200)

    const walletResponse = await SELF.fetch(agentWalletUrl, {
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, agentWalletUrl, 'GET'),
      },
    })
    expect(walletResponse.status).toBe(200)
    const wallet = await walletResponse.json<{
      budgets: Array<{ mode: string; usage: { total: string } }>
    }>()
    expect(wallet.budgets).toEqual(expect.arrayContaining([
      expect.objectContaining({ mode: 'production', usage: { total: '0', period: '0' } }),
      expect.objectContaining({ mode: 'sandbox', usage: { total: '0', period: '0' } }),
    ]))

    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(200)

    const sandboxOverview = await SELF.fetch(
      'https://wallet.test/api/overview?network=eip155%3A84532',
      { headers: { authorization: `Bearer ${token}` } },
    )
    const productionOverview = await SELF.fetch(
      'https://wallet.test/api/overview?network=eip155%3A8453',
      { headers: { authorization: `Bearer ${token}` } },
    )
    expect(await sandboxOverview.json()).toMatchObject({
      grants: [expect.objectContaining({ mode: 'sandbox', spentTotal: '25000' })],
      payments: [expect.objectContaining({ network: 'eip155:84532' })],
    })
    expect(await productionOverview.json()).toMatchObject({
      grants: [expect.objectContaining({ mode: 'production', spentTotal: '0' })],
      payments: [],
    })
  })

  it('rejects duplicate requirements and payments above the Agent transaction limit', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const requirement = paymentRequired('25000')

    const idempotencyKey = crypto.randomUUID()
    const first = await pay(agentToken, requirement, idempotencyKey)
    expect(first.status).toBe(200)
    const replay = await pay(agentToken, requirement, idempotencyKey)
    expect(replay.status).toBe(200)
    expect(await replay.json()).toMatchObject({ replayed: true })
    expect((await pay(agentToken, requirement)).status).toBe(200)
    expect((await pay(agentToken, paymentRequired('26000'), idempotencyKey)).status).toBe(409)
    expect((await pay(agentToken, paymentRequired('100001'))).status).toBe(403)
  })

  it('rejects an uninitialized Solana recipient before reserving Agent budget', async () => {
    const token = await humanToken()
    await provisionAndGrant(token, [
      { family: 'evm', address: walletAddress },
      { family: 'solana', address: '11111111111111111111111111111111' },
    ])
    const agentToken = await createAgentToken()

    const response = await pay(
      agentToken,
      solanaPaymentRequired('25000', '2y5gkUuuwubx6aQfw4wRkzuc6UU6ohqsZrvikS1pLEDP'),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'bad_request',
      message:
        'The Solana payment recipient is not initialized on Solana Devnet. Use an address that already exists on-chain.',
    })
    const overviewResponse = await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
      headers: { authorization: `Bearer ${token}` },
    })
    const state = await overviewResponse.json<{
      grants: Array<{ spentTotal: string }>
      payments: unknown[]
    }>()
    expect(state.grants[0]?.spentTotal).toBe('0')
    expect(state.payments).toEqual([])
  })

  it('returns the authenticated Agent payment state without sensitive authorization data', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const payment = await (
      await pay(agentToken, paymentRequired('25000'))
    ).json<{ paymentId: string }>()
    const url = `${walletUrl}/${payment.paymentId}`
    const response = await SELF.fetch(url, {
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, url, 'GET'),
      },
    })

    expect(response.status, await response.clone().text()).toBe(200)
    const body = await response.json<Record<string, unknown>>()
    expect(body).toMatchObject({
      paymentId: payment.paymentId,
      status: 'signed',
      network: 'eip155:84532',
      amount: '25000',
      payTo: '0x0000000000000000000000000000000000000001',
      resource: 'https://merchant.test/weather',
      transactionHash: null,
      failureReason: null,
      settledAt: null,
    })
    expect(body.authorizationExpiresAt).toEqual(expect.any(String))
    expect(body.createdAt).toEqual(expect.any(String))
    expect(body.updatedAt).toEqual(expect.any(String))
    expect(body).not.toHaveProperty('paymentPayload')
    expect(body).not.toHaveProperty('idempotencyKey')
    const reconciliation = await env.DB.prepare(
      'SELECT authorization_expires_at, next_reconciliation_at FROM payment WHERE id = ?',
    )
      .bind(payment.paymentId)
      .first<{ authorization_expires_at: string; next_reconciliation_at: string }>()
    expect(reconciliation?.next_reconciliation_at).toBe(reconciliation?.authorization_expires_at)

    const missingUrl = `${walletUrl}/${crypto.randomUUID()}`
    const missing = await SELF.fetch(missingUrl, {
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, missingUrl, 'GET'),
      },
    })
    expect(missing.status).toBe(404)
  })

  it('supports the standard x402 HTTP header transport', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const requirement = {
      ...paymentRequired('25000'),
      resource: {
        url: 'https://merchant.test/weather',
        description: 'Paid test weather',
        mimeType: 'application/json',
        serviceName: 'Paid Storage',
        tags: ['storage', 'upload'],
        iconUrl: 'https://merchant.test/icon.svg',
      },
      extensions: {
        'payment-identifier': {
          info: { required: true },
          schema: { type: 'object' },
        },
      },
    }
    const idempotencyKey = crypto.randomUUID()
    const authorization = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, walletUrl, 'POST'),
        'idempotency-key': idempotencyKey,
        'payment-required': encodePaymentRequiredHeader(requirement),
      },
    })

    expect(authorization.status, await authorization.clone().text()).toBe(200)
    const authorizationBody = await authorization.json<{
      paymentId: string
      paymentPayload: Record<string, unknown>
    }>()
    const paymentSignature = decodePaymentSignatureHeader(
      authorization.headers.get('payment-signature')!,
    )
    expect(paymentSignature).toEqual(authorizationBody.paymentPayload)
    expect(paymentSignature.resource).toEqual(requirement.resource)
    expect(paymentSignature.extensions).toMatchObject({
      'payment-identifier': {
        info: {
          required: true,
          id: authorizationBody.paymentId,
        },
      },
    })
    expect(authorizationBody.paymentId).toMatch(/^[A-Za-z0-9_-]{16,128}$/)

    const replay = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, walletUrl, 'POST'),
        'idempotency-key': idempotencyKey,
        'payment-required': encodePaymentRequiredHeader(requirement),
      },
    })
    expect(replay.status, await replay.clone().text()).toBe(200)
    expect(decodePaymentSignatureHeader(replay.headers.get('payment-signature')!)).toEqual(
      paymentSignature,
    )

    const transaction = `0x${'cd'.repeat(32)}`
    const settlementUrl = `${walletUrl}/${authorizationBody.paymentId}/settlement`
    const settlement = await SELF.fetch(settlementUrl, {
      method: 'PUT',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, settlementUrl, 'PUT'),
        'payment-response': encodePaymentResponseHeader({
          success: true,
          payer: walletAddress,
          transaction,
          network: 'eip155:84532',
        }),
      },
    })
    expect(settlement.status, await settlement.clone().text()).toBe(200)
    expect(await settlement.json()).toEqual({
      paymentId: authorizationBody.paymentId,
      status: 'settled',
      transactionHash: transaction,
    })
  })

  it('normalizes nullish x402 resource metadata and validates payment identifiers', () => {
    const requirement = paymentRequired('25000')
    const parsed = paymentRequiredSchema.parse({
      ...requirement,
      resource: {
        url: requirement.resource.url,
        description: null,
        mimeType: null,
        serviceName: null,
        tags: null,
        iconUrl: null,
      },
    })
    expect(JSON.parse(JSON.stringify(parsed.resource))).toEqual({
      url: requirement.resource.url,
    })

    expect(() =>
      appendPaymentIdentifier(
        {
          x402Version: 2,
          resource: requirement.resource,
          accepted: requirement.accepts[0]!,
          payload: {},
          extensions: {
            'payment-identifier': {
              info: { required: true },
            },
          },
        },
        'too-short',
      ),
    ).toThrow(/Payment identifier/)
  })

  it('requires header transport and rejects malformed x402 payment input', async () => {
    const agentToken = await createAgentToken()
    const malformed = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, walletUrl, 'POST'),
        'idempotency-key': crypto.randomUUID(),
        'payment-required': 'not-base64',
      },
    })
    expect(malformed.status).toBe(400)

    const bodyOnly = await SELF.fetch(walletUrl, {
      method: 'POST',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, walletUrl, 'POST'),
        'idempotency-key': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(paymentRequired('25000')),
    })
    expect(bodyOnly.status).toBe(400)

  })

  it('requires an explicit choice between compatible payment requirements without reserving budget', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const firstRequirement = paymentRequired('25000')
    const requirement: PaymentRequired = {
      ...firstRequirement,
      accepts: [
        firstRequirement.accepts[0]!,
        { ...firstRequirement.accepts[0]!, amount: '1000' },
      ],
    }
    const idempotencyKey = crypto.randomUUID()

    const choice = await pay(agentToken, requirement, idempotencyKey)
    expect(choice.status).toBe(422)
    expect(choice.headers.get('content-type')).toContain('application/problem+json')
    expect(choice.headers.get('cache-control')).toBe('no-store')
    const problem = await choice.json<{
      type: string
      status: number
      options: Array<{
        selectionId: string
        index: number
        requirement: PaymentRequired['accepts'][number]
      }>
    }>()
    expect(problem).toMatchObject({
      type: 'https://wallet.test/api/problems/payment-selection-required',
      status: 422,
      options: [
        { index: 0, requirement: { amount: '25000' } },
        { index: 1, requirement: { amount: '1000' } },
      ],
    })
    expect(problem.options[0]?.selectionId).not.toBe(problem.options[1]?.selectionId)

    const afterChoice = await overview(token)
    expect(afterChoice.grants[0]?.spentTotal).toBe('0')
    expect(afterChoice.payments).toEqual([])

    const invalid = await pay(
      agentToken,
      requirement,
      idempotencyKey,
      `offer_${'0'.repeat(32)}`,
    )
    expect(invalid.status).toBe(422)
    const invalidProblem = await invalid.json<{
      detail: string
      options: typeof problem.options
    }>()
    expect(invalidProblem.detail).toContain('invalid or stale')
    expect(invalidProblem.options).toEqual(problem.options)
    const afterInvalid = await overview(token)
    expect(afterInvalid.grants[0]?.spentTotal).toBe('0')
    expect(afterInvalid.payments).toEqual([])

    const selected = problem.options[1]!
    const payment = await pay(
      agentToken,
      requirement,
      idempotencyKey,
      selected.selectionId,
    )
    expect(payment.status, await payment.clone().text()).toBe(200)
    expect(await payment.json()).toMatchObject({
      paymentPayload: { accepted: { amount: '1000' } },
      replayed: false,
    })
    const afterPayment = await overview(token)
    expect(afterPayment.grants[0]?.spentTotal).toBe('1000')
    expect(afterPayment.payments).toHaveLength(1)
  })

  it('records a verified x402 settlement response', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const payment = await (
      await pay(agentToken, paymentRequired('25000'))
    ).json<{ paymentId: string }>()
    const transaction = `0x${'ab'.repeat(32)}`
    const url = `${walletUrl}/${payment.paymentId}/settlement`
    const response = await SELF.fetch(url, {
      method: 'PUT',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, url, 'PUT'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        success: true,
        payer: walletAddress,
        transaction,
        network: 'eip155:84532',
        amount: '25000',
      }),
    })

    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({
      paymentId: payment.paymentId,
      status: 'settled',
      transactionHash: transaction,
    })
    const state = await (
      await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{
      payments: Array<{ status: string; transactionHash: string }>
      auditEvents: Array<{ action: string }>
    }>()
    expect(state.payments[0]).toMatchObject({ status: 'settled', transactionHash: transaction })
    expect(state.auditEvents).toContainEqual(expect.objectContaining({ action: 'payment.settled' }))
  })

  it('enforces the USDC asset allowlist and atomic concurrent limits', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const unsupported = paymentRequired('25000')
    unsupported.accepts[0]!.asset = '0x0000000000000000000000000000000000000002'
    const unsupportedResponse = await pay(agentToken, unsupported)
    expect(unsupportedResponse.status).toBe(422)
    expect(await unsupportedResponse.json()).toMatchObject({
      type: 'https://wallet.test/api/problems/no-supported-payment-requirement',
      options: [],
    })

    const attempts = await Promise.all(
      Array.from({ length: 3 }, () => pay(agentToken, paymentRequired('100000'))),
    )
    expect(attempts.filter((response) => response.status === 200)).toHaveLength(2)
    expect(attempts.filter((response) => response.status === 403)).toHaveLength(1)
  })

  it('soft-deletes an Agent grant without exposing or restoring it', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const state = await (
      await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ grants: Array<{ id: string }> }>()
    const grantId = state.grants[0]!.id
    const grantUrl = `https://wallet.test/api/grants/${grantId}`
    const actionUrl = `${grantUrl}/actions`

    const update = await SELF.fetch(grantUrl, {
      method: 'PUT',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({
        totalLimit: '2000000',
        perTransactionLimit: '50000',
        periodKind: 'daily',
        periodLimit: '500000',
        expiresAt: null,
      }),
    })
    expect(update.status).toBe(204)

    const pause = await SELF.fetch(actionUrl, {
      method: 'POST',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pause.status).toBe(204)
    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(403)

    const resume = await SELF.fetch(actionUrl, {
      method: 'POST',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resume.status).toBe(204)
    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(200)

    const deletion = await SELF.fetch(grantUrl, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(deletion.status).toBe(204)

    const afterDeletion = await (
      await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ grants: Array<{ id: string }>; auditEvents: Array<{ action: string }> }>()
    expect(afterDeletion.grants).toEqual([])
    expect(afterDeletion.auditEvents).toContainEqual(
      expect.objectContaining({ action: 'grant.deleted' }),
    )

    const tombstone = await env.DB
      .prepare('SELECT id, deleted_at FROM agent_grant WHERE id = ?')
      .bind(grantId)
      .first<{ id: string; deleted_at: string | null }>()
    expect(tombstone).toMatchObject({ id: grantId, deleted_at: expect.any(String) })

    const repeatedDeletion = await SELF.fetch(grantUrl, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(repeatedDeletion.status).toBe(404)

    const replacementRequest = await pay(agentToken, paymentRequired('25000'))
    expect(replacementRequest.status).toBe(202)
    const pending = await replacementRequest.json<{
      requestId: string
      approvalUrl: string
    }>()
    const replacementApproval = await approveBudget(token, pending)
    expect(replacementApproval.status).toBe(200)
    const replacement = await replacementApproval.json<{ grantId: string }>()
    expect(replacement.grantId).not.toBe(grantId)

    const storedGrants = await env.DB
      .prepare(
        `SELECT id, deleted_at FROM agent_grant
         WHERE agent_issuer = ? AND agent_subject = ? ORDER BY created_at`,
      )
      .bind(agentIssuer, agentSubject)
      .all<{ id: string; deleted_at: string | null }>()
    expect(storedGrants.results).toEqual([
      { id: grantId, deleted_at: expect.any(String) },
      { id: replacement.grantId, deleted_at: null },
    ])
  })

  it('enforces Wallet emergency pause and grant merchant restrictions', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const overview = await (
      await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{ grants: Array<{ id: string }> }>()
    const grantId = overview.grants[0]!.id
    const walletActionsUrl = 'https://wallet.test/api/wallet/actions'

    const pause = await SELF.fetch(walletActionsUrl, {
      method: 'POST',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({ action: 'pause' }),
    })
    expect(pause.status).toBe(204)
    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(403)

    const resume = await SELF.fetch(walletActionsUrl, {
      method: 'POST',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({ action: 'resume' }),
    })
    expect(resume.status).toBe(204)

    const restricted = await SELF.fetch(`https://wallet.test/api/grants/${grantId}`, {
      method: 'PUT',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({
        totalLimit: '1000000',
        perTransactionLimit: '100000',
        periodKind: 'daily',
        periodLimit: '250000',
        allowedOrigins: ['https://allowed.test'],
        allowedRecipients: ['0x0000000000000000000000000000000000000001'],
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }),
    })
    expect(restricted.status, await restricted.clone().text()).toBe(204)
    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(403)

    const allowed = paymentRequired('25000')
    allowed.resource.url = 'https://allowed.test/weather'
    expect((await pay(agentToken, allowed)).status).toBe(200)

    const state = await (
      await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json<{
      user: { pausedAt: string | null }
      grants: Array<{ allowedOrigins: string[]; allowedRecipients: string[]; expiresAt: string | null }>
      auditEvents: Array<{ action: string }>
    }>()
    expect(state.user.pausedAt).toBeNull()
    expect(state.grants[0]).toMatchObject({
      allowedOrigins: ['https://allowed.test'],
      allowedRecipients: ['0x0000000000000000000000000000000000000001'],
    })
    expect(state.grants[0]?.expiresAt).toBeTruthy()
    expect(state.auditEvents).toContainEqual(expect.objectContaining({ action: 'wallet.paused' }))
    expect(state.auditEvents).toContainEqual(expect.objectContaining({ action: 'wallet.resumed' }))
  })

  it('releases abandoned signing reservations during scheduled cleanup', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const row = await env.DB.prepare(
      `SELECT g.id AS grant_id, g.user_id
       FROM agent_grant g
       JOIN wallet_user u ON u.id = g.user_id
       WHERE u.subject = ?`,
    )
      .bind(ownerSubject)
      .first<{ grant_id: string; user_id: string }>()
    expect(row).toBeTruthy()
    const paymentId = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE agent_grant SET spent_total = '25000', period_spent = '25000' WHERE id = ?",
      ).bind(row!.grant_id),
      env.DB.prepare(
        `INSERT INTO payment (
           id, user_id, grant_id, idempotency_key, requirement_hash, network,
           asset, amount, pay_to, resource, status, reservation_expires_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'eip155:84532', ?, '25000', ?, ?, 'reserved', ?, ?, ?)`,
      ).bind(
        paymentId,
        row!.user_id,
        row!.grant_id,
        crypto.randomUUID(),
        crypto.randomUUID(),
        getDefaultAsset('eip155:84532').address,
        '0x0000000000000000000000000000000000000001',
        'https://merchant.test/stale',
        new Date(Date.now() - 60_000).toISOString(),
        now,
        now,
      ),
    ])

    expect(await cleanupExpiredReservations(env.DB)).toBe(1)
    expect(
      await env.DB.prepare('SELECT spent_total, period_spent FROM agent_grant WHERE id = ?')
        .bind(row!.grant_id)
        .first(),
    ).toMatchObject({ spent_total: '0', period_spent: '0' })
    expect(
      await env.DB.prepare('SELECT status FROM payment WHERE id = ?').bind(paymentId).first(),
    ).toMatchObject({ status: 'failed' })
    expect(
      await env.DB.prepare('SELECT action FROM audit_event WHERE target_id = ?')
        .bind(paymentId)
        .first(),
    ).toMatchObject({ action: 'payment.reservation_expired' })
  })

  it('rejects a replayed DPoP proof', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const proof = await dpopProof(agentToken)
    const requirement = paymentRequired('25000')
    const request = () =>
      SELF.fetch(walletUrl, {
        method: 'POST',
        headers: {
          authorization: `DPoP ${agentToken}`,
          dpop: proof,
          'idempotency-key': crypto.randomUUID(),
          'payment-required': encodePaymentRequiredHeader(requirement),
        },
      })

    expect((await request()).status).toBe(200)
    const replay = await request()
    expect(replay.status).toBe(401)
    expect(await replay.json()).toMatchObject({ error: 'unauthorized' })
    expect(replay.headers.get('www-authenticate')).toContain('invalid_dpop_proof')
  })

  it('rejects an autonomous Agent token because it has no authorizing user', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken(false)

    const response = await pay(agentToken, paymentRequired('25000'))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: 'unauthorized',
      message: 'A delegated Realmroot Agent access token is required.',
    })
    expect(response.headers.get('www-authenticate')).toContain('invalid_token')
  })

  it('rejects an Agent actor from a different issuer', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken(
      true,
      ['wallet:read', 'wallet:budget:request', 'wallet:x402:pay'],
      audience,
      'https://untrusted.example/api/auth',
    )

    const response = await pay(agentToken, paymentRequired('25000'))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: 'unauthorized',
      message: 'A delegated Realmroot Agent access token is required.',
    })
  })

  it('rejects an Agent token issued to a different client', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken(
      true,
      ['wallet:read', 'wallet:budget:request', 'wallet:x402:pay'],
      audience,
      agentIssuer,
      'another-client',
    )

    const response = await pay(agentToken, paymentRequired('25000'))

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({
      error: 'unauthorized',
      message: 'Agent access token client is invalid.',
    })
  })

  it('does not let another user approve an Agent budget request', async () => {
    const otherToken = await humanToken('user-2')
    const agentToken = await createAgentToken()
    const pending = await (await createBudgetRequest(agentToken)).json<{
      requestId: string
      approvalUrl: string
    }>()
    const response = await approveBudget(otherToken, pending)

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: 'not_found',
      message: 'Budget request was not found.',
    })
  })
})

async function humanToken(subject = ownerSubject) {
  return new SignJWT({
    scope: 'openid profile email wallet:read wallet:manage',
    email: 'owner@example.com',
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'human', typ: 'at+jwt' })
    .setIssuer(humanIssuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(humanPrivateKey)
}

async function createAgentToken(
  delegated = true,
  grantedScopes = ['wallet:read', 'wallet:budget:request', 'wallet:x402:pay'],
  tokenAudience = audience,
  actorIssuer = agentIssuer,
  clientId = 'realmroot-cli',
) {
  const thumbprint = await calculateJwkThumbprint(dpopPublicJwk)
  return new SignJWT({
    client_id: clientId,
    scope: grantedScopes.join(' '),
    cnf: { jkt: thumbprint },
    act: delegated
      ? {
          iss: actorIssuer,
          sub: agentSubject,
        }
      : undefined,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'agent', typ: 'at+jwt' })
    .setIssuer(agentIssuer)
    .setAudience(tokenAudience)
    .setSubject(delegated ? ownerSubject : agentSubject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(agentPrivateKey)
}

async function dpopProof(accessToken: string, url = walletUrl, method = 'POST') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  const ath = Buffer.from(digest).toString('base64url')
  return new SignJWT({
    htm: method,
    htu: url,
    ath,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: dpopPublicJwk })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(dpopPrivateKey)
}

async function pay(
  agentToken: string,
  requirement: PaymentRequired,
  idempotencyKey = crypto.randomUUID(),
  selectionId?: string,
) {
  return SELF.fetch(walletUrl, {
    method: 'POST',
    headers: {
      authorization: `DPoP ${agentToken}`,
      dpop: await dpopProof(agentToken, walletUrl, 'POST'),
      'idempotency-key': idempotencyKey,
      'payment-required': encodePaymentRequiredHeader(requirement),
      ...(selectionId ? { 'payment-selection': selectionId } : {}),
    },
  })
}

async function overview(token: string) {
  const response = await SELF.fetch('https://wallet.test/api/overview?network=eip155%3A84532', {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json<{
    grants: Array<{ spentTotal: string }>
    payments: unknown[]
  }>()
}

async function provisionAndGrant(
  token: string,
  accounts: UpdateWalletInput['accounts'] = [{ family: 'evm', address: walletAddress }],
  mode: 'production' | 'sandbox' = 'sandbox',
) {
  const provision = await SELF.fetch('https://wallet.test/api/wallet', {
    method: 'PUT',
    headers: jsonHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      cdpUserId: 'cdp-user-1',
      accounts,
    }),
  })
  expect(provision.status, await provision.clone().text()).toBe(204)
  const agentToken = await createAgentToken()
  const pending = await (await createBudgetRequest(agentToken, mode)).json<{
    requestId: string
    approvalUrl: string
  }>()
  const approval = await approveBudget(token, pending)
  expect(approval.status, await approval.clone().text()).toBe(200)
}

async function createBudgetRequest(
  agentToken: string,
  mode: 'production' | 'sandbox' = 'sandbox',
) {
  return SELF.fetch(budgetRequestsUrl, {
    method: 'POST',
    headers: {
      authorization: `DPoP ${agentToken}`,
      dpop: await dpopProof(agentToken, budgetRequestsUrl, 'POST'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ mode }),
  })
}

function budgetStatus(agentToken: string, requestId: string) {
  const url = `${budgetRequestsUrl}/${requestId}`
  return dpopProof(agentToken, url, 'GET').then((proof) =>
    SELF.fetch(url, {
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: proof,
      },
    }),
  )
}

function approveBudget(
  token: string,
  pending: {
    requestId: string
    approvalUrl: string
  },
) {
  const approvalToken = new URLSearchParams(new URL(pending.approvalUrl).hash.slice(1)).get('token')
  return SELF.fetch(`https://wallet.test/api/budget-requests/${pending.requestId}/decision`, {
    method: 'PUT',
    headers: jsonHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      decision: 'approve',
      approvalToken,
      totalLimit: '1000000',
      perTransactionLimit: '100000',
      periodKind: 'daily',
      periodLimit: '250000',
      expiresAt: null,
    }),
  })
}

function paymentRequired(amount: string) {
  const asset = getDefaultAsset('eip155:84532')
  return {
    x402Version: 2,
    resource: {
      url: 'https://merchant.test/weather',
      description: 'Paid test weather',
      mimeType: 'application/json',
    },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:84532' as const,
        asset: asset.address,
        amount,
        payTo: '0x0000000000000000000000000000000000000001',
        maxTimeoutSeconds: 300,
        extra: {
          name: asset.name,
          version: asset.version,
        },
      },
    ],
  }
}

function paymentRequiredForNetwork(amount: string, network: 'eip155:4801') {
  const asset = walletNetworkDefinition(network).asset
  return {
    x402Version: 2,
    resource: {
      url: 'https://merchant.test/weather',
      description: 'Paid test weather',
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'exact',
      network,
      asset: asset.address,
      amount,
      payTo: '0x0000000000000000000000000000000000000001',
      maxTimeoutSeconds: 300,
      extra: { name: 'USD Coin', version: '2' },
    }],
  }
}

function solanaPaymentRequired(amount: string, payTo: string) {
  const network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const
  return {
    x402Version: 2,
    resource: {
      url: 'https://merchant.test/weather',
      description: 'Paid test weather',
      mimeType: 'application/json',
    },
    accepts: [{
      scheme: 'exact',
      network,
      asset: walletNetworkDefinition(network).asset.address,
      amount,
      payTo,
      maxTimeoutSeconds: 300,
      extra: { feePayer: 'CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5' },
    }],
  }
}

function jsonHeaders(authorization: string) {
  return {
    authorization,
    'content-type': 'application/json',
  }
}
