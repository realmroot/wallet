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
  name: 'Local Codex',
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
  await page.addInitScript(() => {
    if (sessionStorage.getItem('skip-fixture-auth') !== 'true') {
      localStorage.setItem('agent-wallet.access_token', 'browser-test-token')
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
              amount: '12500000',
              decimals: 6,
              assetAddress: network.asset.address,
            },
            { symbol: 'ETH', amount: '10000000000000000', decimals: 18, assetAddress: null },
          ],
          balanceStatus: 'available',
          faucetAssets: network.faucetAssets,
        },
      },
    })
  })
})

test('operates wallet balances, testnet funding, and Agent grants', async ({ page }) => {
  let faucetAsset = ''
  let grantAction = ''
  let walletAction = ''
  let updatedGrant: Record<string, unknown> | null = null
  await page.route('**/api/wallet/faucet', async (route) => {
    faucetAsset = (await route.request().postDataJSON()).asset
    await route.fulfill({ json: { transactionHash: `0x${'cd'.repeat(32)}` } })
  })
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
  await expect(page.getByText('12.5 USDC')).toBeVisible()
  await expect(page.getByText('0.01 ETH')).toBeVisible()
  await expect(page.getByText('Codex Agent')).toBeVisible()
  await expect(page.getByText('Local Codex')).toBeVisible()
  await expect(page.locator('.agent-card .agent-avatar img')).toHaveAttribute(
    'src',
    'https://fa.test/agent-picture-v1.svg',
  )
  await expect(page.getByRole('link', { name: 'Receipt' })).toHaveAttribute(
    'href',
    `https://sepolia.basescan.org/tx/0x${'ab'.repeat(32)}`,
  )

  await page.getByRole('button', { name: 'Get test USDC' }).click()
  await expect.poll(() => faucetAsset).toBe('usdc')

  await page.getByRole('button', { name: 'Pause all Agent payments' }).click()
  await expect.poll(() => walletAction).toBe('pause')

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
  await page.getByLabel('Total USDC').fill('20')
  await page.getByLabel('Allowed merchant origins').fill('https://merchant.test')
  await page.getByRole('button', { name: 'Save rules' }).click()
  await expect.poll(() => updatedGrant?.totalLimit).toBe('20000000')
  await expect.poll(() => updatedGrant?.allowedOrigins).toEqual(['https://merchant.test'])
  await expect(page.getByRole('dialog')).not.toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL('/sandbox/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('OIDC subject')).toBeVisible()
  await expect(page.getByText(
    'Account families are global and do not change with the Network view selector.',
  )).toBeVisible()

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
  await expect(page.getByLabel('Network view')).toHaveValue('eip155:4801')
  await expect(page.locator('#main-content').getByText('World Sepolia', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page).toHaveURL('/sandbox/chains/world-sepolia/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()

  await page.getByLabel('Network view').selectOption('eip155:84532')
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

  await page.getByLabel('Network view').selectOption(solanaDevnetNetwork.id)
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
        requestedName: 'Budget Agent',
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
  await expect(page.getByRole('heading', { name: 'The Agent can now use its budget.' })).toBeVisible()
})

test('completes the shared OIDC callback and restores the requested product mode', async ({ page }) => {
  let tokenExchange: Record<string, unknown> | null = null
  await page.route('**/api/oidc/token', async (route) => {
    tokenExchange = await route.request().postDataJSON()
    await route.fulfill({
      json: {
        access_token: 'callback-access-token',
        refresh_token: 'callback-refresh-token',
        id_token: 'callback-id-token',
        expires_in: 3600,
      },
    })
  })

  await page.goto('/')
  await page.evaluate(() => {
    localStorage.clear()
    sessionStorage.setItem('skip-fixture-auth', 'true')
    sessionStorage.setItem('agent-wallet.state', 'callback-state')
    sessionStorage.setItem('agent-wallet.verifier', 'v'.repeat(64))
    sessionStorage.setItem('agent-wallet.return_to', '/sandbox/activity')
  })
  await page.goto('/oidc/callback?code=authorization-code&state=callback-state')

  await expect(page).toHaveURL('/sandbox/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect.poll(() => tokenExchange).toEqual({
    grantType: 'authorization_code',
    code: 'authorization-code',
    codeVerifier: 'v'.repeat(64),
  })
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('agent-wallet.access_token')))
    .toBe('callback-access-token')
  expect(
    await page.evaluate(() => localStorage.getItem('agent-wallet.session.refresh_token')),
  ).toBe('callback-refresh-token')
  expect(await page.evaluate(() => localStorage.getItem('agent-wallet.refresh_token'))).toBeNull()
})

test('switches product modes without changing API identity or session', async ({ page }) => {
  const requestedApiUrls: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requestedApiUrls.push(request.url())
  })

  await page.goto('/sandbox')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByLabel('Network view')).toHaveValue('eip155:84532')

  await page.getByRole('link', { name: 'Production' }).click()
  await page.waitForURL(appOrigin + '/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await expect(page.getByLabel('Network view')).toHaveValue('eip155:8453')
  expect(requestedApiUrls.some((url) => new URL(url).pathname.startsWith('/api/sandbox'))).toBe(false)
  expect(await page.evaluate(() => localStorage.getItem('agent-wallet.access_token'))).toBe(
    'browser-test-token',
  )
})
test('signs out of the shared Wallet session and clears legacy Sandbox tokens', async ({ page }) => {
  const revokedTokens: string[] = []
  await page.route('**/api/oidc/revoke', async (route) => {
    revokedTokens.push((await route.request().postDataJSON()).token)
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  await page.evaluate(() => {
    sessionStorage.setItem('skip-fixture-auth', 'true')
    localStorage.setItem('agent-wallet.refresh_token', 'production-refresh-token')
    localStorage.setItem('agent-wallet.sandbox.access_token', 'sandbox-access-token')
    localStorage.setItem('agent-wallet.sandbox.refresh_token', 'sandbox-refresh-token')
  })

  const navigation = page.waitForEvent('framenavigated')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await navigation
  await page.waitForLoadState()

  await expect.poll(() => revokedTokens).toEqual(['production-refresh-token'])
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('agent-wallet')),
    ),
  ).toEqual([])
})
