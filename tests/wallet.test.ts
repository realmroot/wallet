import { env, SELF } from 'cloudflare:test'
import { cleanupExpiredReservations } from '../server/repository'
import { hasMatchingDeveloperJwtIdentity } from '../server/cdp'
import { hasMatchingUsdcTransfer } from '../server/settlement'
import { withExplicitEip712Domain } from '../server/signer'
import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { getDefaultAsset } from '@x402/evm'
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { beforeAll, describe, expect, it } from 'vitest'

const humanIssuer = 'https://fa.test/api/auth'
const agentIssuer = humanIssuer
const audience = 'https://wallet.test/api'
const walletUrl = 'https://wallet.test/api/x402/payments'
const budgetRequestsUrl = 'https://wallet.test/api/agent/budget-requests'
const ownerSubject = 'user-1'
const agentSubject = 'agent-1'
const mockSignerPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const walletAddress = privateKeyToAccount(mockSignerPrivateKey).address

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

  it('reports deployment readiness', async () => {
    const response = await SELF.fetch('https://wallet.test/readyz')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
  })

  it('publishes a Restish-discoverable x402 payer contract', async () => {
    const discovery = await SELF.fetch('https://wallet.test/openapi.json')
    expect(discovery.status).toBe(200)
    expect(discovery.headers.get('link')).toContain('rel="service-desc"')
    expect(await discovery.json()).toMatchObject({
      servers: [{ url: 'https://wallet.test/api' }],
      components: {
        securitySchemes: {
          DPoP: {
            type: 'http',
            scheme: 'DPoP',
          },
          ScopeCatalog: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://fa.test/api/auth/oauth2/authorize',
                tokenUrl: 'https://fa.test/api/auth/oauth2/token',
                scopes: {
                  'wallet:x402:pay': expect.any(String),
                },
              },
            },
          },
        },
      },
      'x-cli-config': {
        profiles: {
          default: {
            credentials: {
              DPoP: {
                params: { provider: 'realmroot-target' },
              },
            },
          },
        },
      },
      paths: {
        '/x402/payments': {
          post: {
            operationId: 'createX402Payment',
            security: [{ DPoP: [] }, { ScopeCatalog: ['wallet:x402:pay'] }],
          },
        },
      },
    })

    const root = await SELF.fetch('https://wallet.test/api')
    expect(root.status).toBe(200)
    expect(root.headers.get('link')).toContain('https://wallet.test/openapi.json')
    expect(root.headers.get('x-request-id')).toBeTruthy()
    expect(await root.json()).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/x402/payments': {
          post: { operationId: 'createX402Payment' },
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
      'x-x402': {
        role: 'payer',
        paymentOperationId: 'createX402Payment',
      },
      paths: {
        '/x402/payments': {
          post: { operationId: 'createX402Payment' },
        },
      },
    })
    expect(Object.keys(document.paths).sort()).toEqual([
      '/agent/budget-requests',
      '/agent/budget-requests/{id}',
      '/x402/payments',
      '/x402/payments/{id}/settlement',
    ])

    expect((await SELF.fetch('https://wallet.test/api/user-openapi.json')).status).toBe(404)
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

  it('exchanges and revokes browser OIDC tokens through the same-origin Wallet API', async () => {
    const exchange = await SELF.fetch('https://wallet.test/api/oidc/token', {
      method: 'POST',
      headers: {
        origin: 'https://wallet.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grantType: 'authorization_code',
        code: 'authorization-code',
        codeVerifier: 'v'.repeat(64),
      }),
    })
    expect(exchange.status, await exchange.clone().text()).toBe(200)
    expect(await exchange.json()).toEqual({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
      expires_in: 3600,
    })

    const revoke = await SELF.fetch('https://wallet.test/api/oidc/revoke', {
      method: 'POST',
      headers: {
        origin: 'https://wallet.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ token: 'refresh-token' }),
    })
    expect(revoke.status).toBe(204)

    const crossOrigin = await SELF.fetch('https://wallet.test/api/oidc/token', {
      method: 'POST',
      headers: {
        origin: 'https://attacker.test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        grantType: 'authorization_code',
        code: 'authorization-code',
        codeVerifier: 'v'.repeat(64),
      }),
    })
    expect(crossOrigin.status).toBe(403)
  })

  it('provisions a wallet and approves a budget requested by the payment operation', async () => {
    const token = await humanToken()

    const initial = await SELF.fetch('https://wallet.test/api/overview', {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(initial.status, await initial.clone().text()).toBe(200)
    expect((await initial.json<{ user: { subject: string } }>()).user.subject).toBe(ownerSubject)

    const provision = await SELF.fetch('https://wallet.test/api/wallet', {
      method: 'PUT',
      headers: jsonHeaders(`Bearer ${token}`),
      body: JSON.stringify({
        cdpUserId: 'cdp-user-1',
        address: walletAddress,
      }),
    })
    expect(provision.status).toBe(204)

    const agentToken = await createAgentToken()
    const request = await pay(agentToken, paymentRequired('25000'))
    expect(request.status).toBe(202)
    const pending = await request.json<{ id: string; status: string; approvalUrl: string }>()
    expect(pending.status).toBe('pending')
    expect(pending.approvalUrl).toContain('/authorize#request=')

    const decision = await approveBudget(token, pending)
    expect(decision.status, await decision.clone().text()).toBe(200)
    expect(await decision.json()).toMatchObject({ status: 'approved' })

    const status = await budgetStatus(agentToken, pending.id)
    expect(status.status).toBe(200)
    expect(await status.json()).toMatchObject({ status: 'approved' })
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

    const overview = await SELF.fetch('https://wallet.test/api/overview', {
      headers: { authorization: `Bearer ${token}` },
    })
    const state = await overview.json<{
      grants: Array<{ spentTotal: string }>
      payments: Array<{ status: string }>
    }>()
    expect(state.grants[0]?.spentTotal).toBe('25000')
    expect(state.payments[0]?.status).toBe('signed')
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
      method: 'POST',
      headers: {
        authorization: `DPoP ${agentToken}`,
        dpop: await dpopProof(agentToken, url, 'POST'),
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
      await SELF.fetch('https://wallet.test/api/overview', {
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
    expect((await pay(agentToken, unsupported)).status).toBe(400)

    const attempts = await Promise.all(
      Array.from({ length: 3 }, () => pay(agentToken, paymentRequired('100000'))),
    )
    expect(attempts.filter((response) => response.status === 200)).toHaveLength(2)
    expect(attempts.filter((response) => response.status === 403)).toHaveLength(1)
  })

  it('lets the controller update, pause, resume, and revoke an Agent grant', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const state = await (
      await SELF.fetch('https://wallet.test/api/overview', {
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
        name: 'Production Codex',
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

    const revoke = await SELF.fetch(grantUrl, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(revoke.status).toBe(204)
    expect((await pay(agentToken, paymentRequired('25000'))).status).toBe(202)
  })

  it('enforces Wallet emergency pause and grant merchant restrictions', async () => {
    const token = await humanToken()
    await provisionAndGrant(token)
    const agentToken = await createAgentToken()
    const overview = await (
      await SELF.fetch('https://wallet.test/api/overview', {
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
        name: 'Restricted Codex',
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
      await SELF.fetch('https://wallet.test/api/overview', {
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
    const request = () =>
      SELF.fetch(walletUrl, {
        method: 'POST',
        headers: {
          authorization: `DPoP ${agentToken}`,
          dpop: proof,
          'idempotency-key': crypto.randomUUID(),
          'content-type': 'application/json',
        },
        body: JSON.stringify(paymentRequired('25000')),
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

  it('does not let another user approve an Agent budget request', async () => {
    const otherToken = await humanToken('user-2')
    const agentToken = await createAgentToken()
    const pending = await (await createBudgetRequest(agentToken)).json<{
      id: string
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

async function createAgentToken(delegated = true) {
  const thumbprint = await calculateJwkThumbprint(dpopPublicJwk)
  return new SignJWT({
    scope: 'wallet:x402:pay',
    cnf: { jkt: thumbprint },
    act: delegated
      ? {
          iss: agentIssuer,
          sub: 'host-1',
          actor_type: 'host',
          act: { iss: agentIssuer, sub: agentSubject, actor_type: 'agent' },
        }
      : { iss: agentIssuer, sub: 'host-1', actor_type: 'host' },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'agent', typ: 'at+jwt' })
    .setIssuer(agentIssuer)
    .setAudience(audience)
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
  requirement: ReturnType<typeof paymentRequired>,
  idempotencyKey = crypto.randomUUID(),
) {
  return SELF.fetch(walletUrl, {
    method: 'POST',
    headers: {
      authorization: `DPoP ${agentToken}`,
      dpop: await dpopProof(agentToken, walletUrl, 'POST'),
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(requirement),
  })
}

async function provisionAndGrant(token: string) {
  const provision = await SELF.fetch('https://wallet.test/api/wallet', {
    method: 'PUT',
    headers: jsonHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      cdpUserId: 'cdp-user-1',
      address: walletAddress,
    }),
  })
  expect(provision.status, await provision.clone().text()).toBe(204)
  const agentToken = await createAgentToken()
  const pending = await (await createBudgetRequest(agentToken)).json<{
    id: string
    approvalUrl: string
  }>()
  const approval = await approveBudget(token, pending)
  expect(approval.status, await approval.clone().text()).toBe(200)
}

async function createBudgetRequest(agentToken: string) {
  return SELF.fetch(budgetRequestsUrl, {
    method: 'POST',
    headers: {
      authorization: `DPoP ${agentToken}`,
      dpop: await dpopProof(agentToken, budgetRequestsUrl, 'POST'),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Local Codex' }),
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
    id: string
    approvalUrl: string
  },
) {
  const approvalToken = new URLSearchParams(new URL(pending.approvalUrl).hash.slice(1)).get('token')
  return SELF.fetch(`https://wallet.test/api/budget-requests/${pending.id}/decision`, {
    method: 'PUT',
    headers: jsonHeaders(`Bearer ${token}`),
    body: JSON.stringify({
      decision: 'approve',
      approvalToken,
      name: 'Local Codex',
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

function jsonHeaders(authorization: string) {
  return {
    authorization,
    'content-type': 'application/json',
  }
}
