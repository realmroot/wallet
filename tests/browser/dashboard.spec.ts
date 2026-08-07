import { expect, test } from '@playwright/test'

const walletAddress = '0x1111111111111111111111111111111111111111'
const appOrigin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:6230'
const baseMainnetNetwork = {
  id: 'eip155:8453',
  alias: 'base',
  name: 'Base',
  mode: 'production',
  family: 'evm',
  asset: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
  },
  nativeSymbol: 'ETH',
  explorerOrigin: 'https://basescan.org',
  paymentsEnabled: false,
  faucetAssets: [],
}
const baseSepoliaNetwork = {
  id: 'eip155:84532',
  alias: 'base-sepolia',
  name: 'Base Sepolia',
  mode: 'sandbox',
  family: 'evm',
  asset: {
    symbol: 'USDC',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
  },
  nativeSymbol: 'ETH',
  explorerOrigin: 'https://sepolia.basescan.org',
  paymentsEnabled: true,
  faucetAssets: ['usdc', 'native'],
}
const worldSepoliaNetwork = {
  ...baseSepoliaNetwork,
  id: 'eip155:4801',
  alias: 'world-sepolia',
  name: 'World Sepolia',
  asset: {
    ...baseSepoliaNetwork.asset,
    address: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
  },
  explorerOrigin: 'https://sepolia.worldscan.org',
  faucetAssets: [],
}
const solanaDevnetNetwork = {
  id: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  alias: 'solana-devnet',
  name: 'Solana Devnet',
  mode: 'sandbox',
  family: 'solana',
  asset: {
    symbol: 'USDC',
    address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    decimals: 6,
  },
  nativeSymbol: 'SOL',
  explorerOrigin: 'https://explorer.solana.com',
  paymentsEnabled: true,
  faucetAssets: ['usdc', 'native'],
}
const grant = {
  id: 'grant-1',
  agentIssuer: 'https://fa.test/api/auth',
  agentSubject: 'agent-codex',
  mode: 'sandbox',
  totalLimit: '10000000',
  spentTotal: '25000',
  perTransactionLimit: '1000000',
  periodKind: 'daily',
  periodLimit: '3000000',
  periodSpent: '25000',
  allowedOrigins: ['https://merchant.test'],
  allowedRecipients: ['0x2222222222222222222222222222222222222222'],
  expiresAt: null,
  pausedAt: null as string | null,
  revokedAt: null,
}

test.beforeEach(async ({ page }) => {
  const fundedAssets = new Set<string>()
  await page.addInitScript(() => {
    if (sessionStorage.getItem('skip-fixture-auth') !== 'true') {
      localStorage.setItem('agent-wallet.access_token', 'browser-test-token')
      localStorage.setItem('agent-wallet.identity', JSON.stringify({
        subject: 'user-1',
        name: null,
        email: 'owner@example.com',
        picture: null,
      }))
    }
  })
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appOrigin,
        appBaseUrl: appOrigin,
        oidcIssuer: 'https://fa.test/api/auth',
        clientId: 'agent-wallet-web',
        audience: `${appOrigin}/api`,
        agentIssuer: 'https://fa.test/api/auth',
        defaultNetwork: 'eip155:8453',
        networks: [baseMainnetNetwork, baseSepoliaNetwork, worldSepoliaNetwork],
        cdpProjectId: null,
      },
    }),
  )
  await page.route('https://fa.test/api/auth/.well-known/openid-configuration', (route) =>
    route.fulfill({
      json: {
        issuer: 'https://fa.test/api/auth',
        authorization_endpoint: 'https://fa.test/api/auth/oauth2/authorize',
        token_endpoint: 'https://fa.test/api/auth/oauth2/token',
        revocation_endpoint: 'https://fa.test/api/auth/oauth2/revoke',
        agentinfo_endpoint: 'https://fa.test/api/auth/agentinfo',
      },
    }),
  )
  await page.route('https://fa.test/api/auth/agentinfo?*', (route) => {
    const subject = new URL(route.request().url()).searchParams.get('sub')
    const names: Record<string, string> = {
      'agent-codex': 'Codex Agent',
      'agent-budget-request': 'Budget Agent Identity',
    }
    return route.fulfill({
      json: {
        iss: 'https://fa.test/api/auth',
        sub: subject,
        sub_profile: 'ai_agent',
        name: names[subject ?? ''] ?? 'Test Agent',
        picture: 'https://fa.test/agent-picture-v1.svg',
        updated_at: 1_785_450_000,
      },
    })
  })
  await page.route('https://fa.test/agent-picture-v1.svg', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>',
    }),
  )
  await page.route('**/api/wallet/faucet', async (route) => {
    const input = await route.request().postDataJSON() as { asset: string }
    fundedAssets.add(input.asset)
    await route.fulfill({ json: { transactionHash: `0x${'cd'.repeat(32)}` } })
  })
  await page.route('**/api/overview*', (route) => {
    const requestedNetwork = new URL(route.request().url()).searchParams.get('network')
    const network = [baseMainnetNetwork, baseSepoliaNetwork, worldSepoliaNetwork]
      .find((candidate) => candidate.id === requestedNetwork) ?? baseMainnetNetwork
    return route.fulfill({
      json: {
        user: {
          id: 'user-1',
          issuer: 'https://fa.test/api/auth',
          subject: 'user-1',
          email: 'owner@example.com',
          cdpUserId: 'cdp-user-1',
          accounts: [{
            id: 'account-1',
            family: 'evm',
            address: walletAddress,
            delegationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }],
          pausedAt: null,
        },
        grants: [grant],
        payments: [
          {
            id: 'payment-1',
            network: 'eip155:84532',
            amount: '25000',
            payTo: '0x2222222222222222222222222222222222222222',
            resource: 'https://merchant.test/weather',
            status: 'settled',
            transactionHash: `0x${'ab'.repeat(32)}`,
            error: null,
            createdAt: new Date().toISOString(),
          },
        ],
        auditEvents: [
          {
            id: 'audit-1',
            actorKind: 'human',
            actorSubject: 'user-1',
            action: 'grant.updated',
            targetType: 'grant',
            targetId: 'grant-1',
            metadata: null,
            createdAt: new Date().toISOString(),
          },
        ],
        runtime: {
          network: network.id,
          family: 'evm',
          account: {
            id: 'account-1',
            family: 'evm',
            address: walletAddress,
            delegationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
          balances: [
            {
              symbol: 'USDC',
              amount: fundedAssets.has('usdc') ? '13500000' : '12500000',
              decimals: 6,
              assetAddress: network.asset.address,
            },
            {
              symbol: 'ETH',
              amount: fundedAssets.has('native') ? '110000000000000000' : '10000000000000000',
              decimals: 18,
              assetAddress: null,
            },
          ],
          balanceStatus: 'available',
          faucetAssets: network.faucetAssets,
        },
      },
    })
  })
})

test('operates wallet balances, testnet funding, and Agent grants', async ({ page }) => {
  let grantAction = ''
  let walletAction = ''
  let updatedGrant: Record<string, unknown> | null = null
  await page.route('**/api/grants/grant-1/actions', async (route) => {
    grantAction = (await route.request().postDataJSON()).action
    grant.pausedAt = new Date().toISOString()
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/wallet/actions', async (route) => {
    walletAction = (await route.request().postDataJSON()).action
    await route.fulfill({ status: 204 })
  })
  await page.route('**/api/grants/grant-1', async (route) => {
    if (route.request().method() === 'PUT') updatedGrant = await route.request().postDataJSON()
    await route.fulfill({ status: 204 })
  })

  await page.goto('/sandbox')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.locator('.primary-balance')).toContainText('12.5')
  await expect(page.locator('.primary-balance')).toContainText('USDC')
  await expect(page.locator('.balance-supporting-metrics')).toContainText('0.01 ETH')
  await expect(page.getByText('Codex Agent')).toBeVisible()
  await expect(page.locator('.agent-card .agent-avatar img')).toHaveAttribute(
    'src',
    'https://fa.test/agent-picture-v1.svg',
  )
  await expect(page.getByRole('link', { name: 'Receipt' })).toHaveAttribute(
    'href',
    `https://sepolia.basescan.org/tx/0x${'ab'.repeat(32)}`,
  )

  await page.getByRole('button', { name: 'Get test USDC' }).click()
  await expect(page.locator('.primary-balance')).toContainText('13.5')

  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect.poll(() => grantAction).toBe('pause')
  await expect(page.getByText('Paused')).toBeVisible()

  await page.evaluate(() => {
    sessionStorage.removeItem('menu-transition-seen')
    new MutationObserver(() => {
      if (document.querySelector('.transition-screen')) {
        sessionStorage.setItem('menu-transition-seen', 'true')
      }
    }).observe(document.body, { childList: true, subtree: true })
  })

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page).toHaveURL('/sandbox/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByText('Grant Updated')).toBeVisible()

  await page.getByRole('link', { name: 'Agents' }).click()
  await expect(page).toHaveURL('/sandbox/agents')
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByLabel('Name')).toHaveCount(0)
  await page.getByLabel('Total USDC').fill('20')
  await page.getByLabel('Allowed merchant origins').fill('https://merchant.test')
  await page.getByRole('button', { name: 'Save rules' }).click()
  await expect.poll(() => updatedGrant?.totalLimit).toBe('20000000')
  await expect.poll(() => updatedGrant?.allowedOrigins).toEqual(['https://merchant.test'])
  expect(updatedGrant).not.toHaveProperty('name')
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('link', { name: 'Accounts' }).click()
  await expect(page).toHaveURL('/sandbox/accounts')
  await expect(page.getByRole('heading', { name: 'Wallet accounts', level: 1 })).toBeVisible()
  await expect(page.getByText(
    'One account per chain family. Compatible EVM networks share the same address.',
  )).toBeVisible()
  await page.getByRole('button', { name: 'Pause all Agent payments' }).click()
  await expect.poll(() => walletAction).toBe('pause')

  await page.getByRole('link', { name: 'Payments' }).click()
  await expect(page).toHaveURL('/sandbox/payments')
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()

  await page.getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL('/sandbox/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('menu-transition-seen'))).toBeNull()
})

test('uses the selected network for block explorer links', async ({ page }) => {
  await page.goto('/sandbox')

  await expect(page.getByRole('link', { name: 'View wallet in the block explorer' })).toHaveAttribute(
    'href',
    `https://sepolia.basescan.org/address/${walletAddress}`,
  )
  await expect(page.getByRole('link', { name: 'Receipt' })).toHaveAttribute(
    'href',
    `https://sepolia.basescan.org/tx/0x${'ab'.repeat(32)}`,
  )
})

test('keeps non-default network routes across internal navigation', async ({ page }) => {
  await page.goto('/sandbox/chains/world-sepolia')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  const networkView = page.getByLabel('Current wallet context').getByRole('button', { name: 'Network view: World Sepolia' })
  await expect(networkView).toBeVisible()
  await expect(page.getByRole('heading', { name: 'World Sepolia', level: 2 })).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page).toHaveURL('/sandbox/chains/world-sepolia/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()

  await networkView.click()
  await page.getByRole('menuitem', { name: 'Base Sepolia EVM' }).click()
  await page.waitForURL('/sandbox/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
})

test('creates only the account family required by the selected network', async ({ page }) => {
  const networks = [baseSepoliaNetwork, worldSepoliaNetwork, solanaDevnetNetwork]
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appOrigin,
        appBaseUrl: appOrigin,
        oidcIssuer: 'https://fa.test/api/auth',
        clientId: 'agent-wallet-web',
        audience: `${appOrigin}/api`,
        agentIssuer: 'https://fa.test/api/auth',
        defaultNetwork: baseSepoliaNetwork.id,
        networks,
        cdpProjectId: 'cdp-project',
      },
    }),
  )
  await page.route('**/api/overview*', (route) => {
    const requestedNetwork = new URL(route.request().url()).searchParams.get('network')
    const network =
      networks.find((candidate) => candidate.id === requestedNetwork) ?? baseSepoliaNetwork
    return route.fulfill({
      json: {
        user: {
          id: 'user-1',
          issuer: 'https://fa.test/api/auth',
          subject: 'user-1',
          email: 'owner@example.com',
          cdpUserId: null,
          accounts: [],
          pausedAt: null,
        },
        grants: [],
        payments: [],
        auditEvents: [],
        runtime: {
          network: network.id,
          family: network.family,
          account: null,
          balances: [],
          balanceStatus: 'unavailable',
          faucetAssets: network.faucetAssets,
        },
      },
    })
  })

  await page.goto('/sandbox')
  await expect(page.getByRole('button', { name: 'Set up EVM wallet' })).toBeVisible()
  await page.getByRole('button', { name: 'Set up EVM wallet' }).click()
  const evmDialog = page.getByRole('dialog')
  await expect(evmDialog.getByRole('heading', { name: 'Set up EVM wallet' })).toBeVisible()
  await expect(evmDialog).toContainText('shared by Base Sepolia and World Sepolia')
  await expect(evmDialog.getByRole('radio')).toHaveCount(0)
  await evmDialog.getByRole('button', { name: 'Cancel' }).click()

  await page.getByLabel('Current wallet context').getByRole('button', { name: 'Network view: Base Sepolia' }).click()
  await page.getByRole('menuitem', { name: 'Solana Devnet Solana' }).click()
  await expect(page).toHaveURL('/sandbox/chains/solana-devnet')
  await expect(page.getByRole('button', { name: 'Set up Solana wallet' })).toBeVisible()
  await page.getByRole('button', { name: 'Set up Solana wallet' }).click()
  const solanaDialog = page.getByRole('dialog')
  await expect(solanaDialog.getByRole('heading', { name: 'Set up Solana wallet' })).toBeVisible()
  await expect(solanaDialog).toContainText('remains separate from your EVM account')
  await expect(solanaDialog.getByRole('radio')).toHaveCount(0)
})

test('validates and approves an Agent budget request', async ({ page }) => {
  let decision: Record<string, unknown> | null = null
  await page.route('**/api/budget-requests/request-1/inspect', async (route) => {
    expect(await route.request().postDataJSON()).toEqual({ approvalToken: 'a'.repeat(32) })
    await route.fulfill({
      json: {
        id: 'request-1',
        status: 'pending',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        grantId: null,
        mode: 'production',
        agentIssuer: 'https://fa.test/api/auth',
        agentSubject: 'agent-budget-request',
      },
    })
  })
  await page.route('**/api/budget-requests/request-1/decision', async (route) => {
    decision = await route.request().postDataJSON()
    await route.fulfill({ json: { status: 'approved', grantId: 'grant-2' } })
  })

  await page.goto(`/authorize#request=request-1&token=${'a'.repeat(32)}`)
  await expect(page.getByRole('heading', { name: 'Allow this Agent to spend?' })).toBeVisible()
  await expect(page.getByText('Budget Agent Identity')).toBeVisible()
  await expect(page.getByText('agent-budget-request')).toBeVisible()

  await page.getByLabel('Allowed recipient addresses').fill('not-an-address')
  await page.getByRole('button', { name: 'Authorize budget' }).click()
  await expect(page.getByText('Invalid recipient address: not-an-address')).toBeVisible()
  expect(decision).toBeNull()

  await page.getByLabel('Allowed recipient addresses').fill(
    '0x2222222222222222222222222222222222222222',
  )
  await page.getByRole('button', { name: 'Authorize budget' }).click()
  await expect.poll(() => decision?.decision).toBe('approve')
  await expect.poll(() => decision?.totalLimit).toBe('10000000')
  expect(decision).not.toHaveProperty('name')
  await expect(page.getByRole('heading', { name: 'The Agent can now use its budget.' })).toBeVisible()
})

test('completes the shared OIDC callback and restores the requested product mode', async ({ page }) => {
  let tokenExchange: Record<string, string> | null = null
  await page.route('https://fa.test/api/auth/oauth2/token', async (route) => {
    tokenExchange = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ''))
    await route.fulfill({
      headers: { 'access-control-allow-origin': appOrigin },
      json: {
        access_token: 'callback-access-token',
        refresh_token: 'callback-refresh-token',
        id_token: idToken({
          nonce: 'callback-nonce',
          name: 'Owner Example',
          email: 'owner@example.com',
          picture: 'https://fa.test/owner-picture.svg',
        }),
        token_type: 'Bearer',
        expires_in: 3600,
      },
    })
  })

  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.setItem('skip-fixture-auth', 'true')
    sessionStorage.setItem('agent-wallet.state', 'callback-state')
    sessionStorage.setItem('agent-wallet.nonce', 'callback-nonce')
    sessionStorage.setItem('agent-wallet.verifier', 'v'.repeat(64))
    sessionStorage.setItem('agent-wallet.return_to', '/sandbox/activity')
  })
  await page.goto('/oidc/callback?code=authorization-code&state=callback-state')

  await expect(page).toHaveURL('/sandbox/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect.poll(() => tokenExchange).toEqual({
    client_id: 'agent-wallet-web',
    code: 'authorization-code',
    code_verifier: 'v'.repeat(64),
    grant_type: 'authorization_code',
    redirect_uri: `${appOrigin}/oidc/callback`,
    resource: `${appOrigin}/api`,
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('agent-wallet.access_token')))
    .toBe('callback-access-token')
  expect(
    await page.evaluate(() => localStorage.getItem('agent-wallet.session.refresh_token')),
  ).toBe('callback-refresh-token')
  expect(await page.evaluate(() => localStorage.getItem('agent-wallet.refresh_token'))).toBeNull()
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('agent-wallet.identity') ?? 'null')),
  ).toEqual({
    subject: 'user-1',
    name: 'Owner Example',
    email: 'owner@example.com',
    picture: 'https://fa.test/owner-picture.svg',
  })
  await expect(page.getByText('Owner Example').first()).toBeVisible()
})

test('switches product modes without changing API identity or session', async ({ page }) => {
  const requestedApiUrls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requestedApiUrls.push(request.url())
  })

  await page.goto('/sandbox')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  const networkMenu = page.getByLabel('Current wallet context').getByRole('button', { name: 'Network view: Base Sepolia' })
  await networkMenu.hover()
  await expect(page.getByRole('menuitem', { name: 'World Sepolia EVM' })).toBeVisible()
  await page.getByLabel('Open account menu for owner@example.com').hover()
  await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()

  await page.getByLabel('Wallet environment: Sandbox').hover()
  await expect(page.getByRole('menuitem', { name: 'Production' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Production' }).click()
  await page.waitForURL(appOrigin + '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByLabel('Current wallet context').getByRole('button', { name: 'Network view: Base' })).toBeVisible()
  expect(requestedApiUrls.some((url) => new URL(url).pathname.startsWith('/api/sandbox'))).toBe(false)
  expect(await page.evaluate(() => localStorage.getItem('agent-wallet.access_token'))).toBe(
    'browser-test-token',
  )
})
test('signs out of the shared Wallet session and clears legacy Sandbox tokens', async ({ page }) => {
  const revokedTokens: string[] = []
  await page.route('https://fa.test/api/auth/oauth2/revoke', async (route) => {
    const body = new URLSearchParams(route.request().postData() ?? '')
    revokedTokens.push(body.get('token') ?? '')
    await route.fulfill({ status: 200, headers: { 'access-control-allow-origin': appOrigin } })
  })
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.setItem('skip-fixture-auth', 'true')
    localStorage.setItem('agent-wallet.refresh_token', 'production-refresh-token')
    localStorage.setItem('agent-wallet.sandbox.access_token', 'sandbox-access-token')
    localStorage.setItem('agent-wallet.sandbox.refresh_token', 'sandbox-refresh-token')
  })

  const navigation = page.waitForEvent('framenavigated')
  await page.getByLabel('Open account menu').click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await navigation
  await page.waitForLoadState()

  await expect.poll(() => revokedTokens).toEqual(['production-refresh-token'])
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('agent-wallet')),
    ),
  ).toEqual([])
})

function idToken(profile: {
  nonce: string
  name: string
  email: string
  picture: string
}) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  return [
    encode({ alg: 'RS256', kid: 'browser-test', typ: 'JWT' }),
    encode({
      iss: 'https://fa.test/api/auth',
      sub: 'user-1',
      aud: 'agent-wallet-web',
      iat: now,
      exp: now + 3600,
      ...profile,
    }),
    'browser-test-signature',
  ].join('.')
}
