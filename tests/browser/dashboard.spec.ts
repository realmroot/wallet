import { expect, test } from '@playwright/test'

const walletAddress = '0x1111111111111111111111111111111111111111'
const grant = {
  id: 'grant-1',
  agentIssuer: 'https://fa.test/api/auth',
  agentSubject: 'agent-codex',
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
        appOrigin: 'http://localhost:6230',
        appBaseUrl: 'http://localhost:6230',
        oidcIssuer: 'https://fa.test/api/auth',
        clientId: 'agent-wallet-web',
        audience: 'http://localhost:6230/api',
        agentIssuer: 'https://fa.test/api/auth',
        environment: 'production',
        network: 'eip155:84532',
        paymentsEnabled: true,
        cdpProjectId: null,
      },
    }),
  )
  await page.route('https://fa.test/api/auth/.well-known/openid-configuration', (route) =>
    route.fulfill({
      json: {
        issuer: 'https://fa.test/api/auth',
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
  await page.route('**/api/overview', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'user-1',
          issuer: 'https://fa.test/api/auth',
          subject: 'user-1',
          email: 'owner@example.com',
          cdpUserId: 'cdp-user-1',
          walletAddress,
          delegationExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          pausedAt: null,
        },
        grants: [grant],
        payments: [
          {
            id: 'payment-1',
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
          balances: [
            {
              symbol: 'USDC',
              amount: '12500000',
              decimals: 6,
              contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            },
            { symbol: 'ETH', amount: '10000000000000000', decimals: 18, contractAddress: null },
          ],
          balanceStatus: 'available',
          faucetAvailable: true,
        },
      },
    }),
  )
})

test('operates wallet balances, testnet funding, and Agent grants', async ({ page }) => {
  let faucetToken = ''
  let grantAction = ''
  let walletAction = ''
  let updatedGrant: Record<string, unknown> | null = null
  await page.route('**/api/wallet/faucet', async (route) => {
    faucetToken = (await route.request().postDataJSON()).token
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

  await page.goto('/')
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
  await expect.poll(() => faucetToken).toBe('usdc')

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
  await expect(page).toHaveURL('/activity')
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByText('Grant Updated')).toBeVisible()

  await page.getByRole('link', { name: 'Agents' }).click()
  await expect(page).toHaveURL('/agents')
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
  await expect(page).toHaveURL('/settings')
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('OIDC subject')).toBeVisible()

  await page.getByRole('link', { name: 'Payments' }).click()
  await expect(page).toHaveURL('/payments')
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible()

  await page.getByRole('link', { name: 'Overview' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('menu-transition-seen'))).toBeNull()
})

test('uses the configured network for BaseScan links', async ({ page }) => {
  await page.unroute('**/api/config')
  await page.route('**/api/config', (route) =>
    route.fulfill({
      json: {
        appOrigin: 'http://localhost:6230',
        appBaseUrl: 'http://localhost:6230',
        oidcIssuer: 'https://fa.test/api/auth',
        clientId: 'agent-wallet-web',
        audience: 'http://localhost:6230/api',
        agentIssuer: 'https://fa.test/api/auth',
        environment: 'production',
        network: 'eip155:8453',
        paymentsEnabled: false,
        cdpProjectId: null,
      },
    }),
  )

  await page.goto('/')

  await expect(page.getByRole('link', { name: 'View wallet on BaseScan' })).toHaveAttribute(
    'href',
    `https://basescan.org/address/${walletAddress}`,
  )
  await expect(page.getByRole('link', { name: 'Receipt' })).toHaveAttribute(
    'href',
    `https://basescan.org/tx/0x${'ab'.repeat(32)}`,
  )
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

test('completes the OIDC callback and renders the requested page', async ({ page }) => {
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
    sessionStorage.setItem('agent-wallet.state', 'callback-state')
    sessionStorage.setItem('agent-wallet.verifier', 'v'.repeat(64))
    sessionStorage.setItem('agent-wallet.return_to', '/activity')
  })
  await page.goto('/oidc/callback?code=authorization-code&state=callback-state')

  await expect(page).toHaveURL('/activity')
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

test('switches environments through the shared session without visible OIDC navigation', async ({ page }) => {
  let tokenExchange: Record<string, unknown> | null = null
  let exchangeComplete = false
  let discoveryRequested = false
  let observeDiscovery = false
  await page.route('**/api/sandbox/config', (route) =>
    route.fulfill({
      json: {
        appOrigin: 'http://localhost:6230',
        appBaseUrl: 'http://localhost:6230/sandbox',
        oidcIssuer: 'https://fa.test/api/auth',
        clientId: 'agent-wallet-web',
        audience: 'http://localhost:6230/api/sandbox',
        agentIssuer: 'https://fa.test/api/auth',
        environment: 'sandbox',
        network: 'eip155:84532',
        paymentsEnabled: true,
        cdpProjectId: null,
      },
    }),
  )
  await page.route('**/api/sandbox/overview', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250))
    await route.fulfill({
      json: {
        user: {
          id: 'sandbox-user',
          issuer: 'https://fa.test/api/auth',
          subject: 'user-1',
          email: 'owner@example.com',
          cdpUserId: null,
          walletAddress: null,
          delegationExpiresAt: null,
          pausedAt: null,
        },
        grants: [],
        payments: [],
        auditEvents: [],
        runtime: {
          balances: [],
          balanceStatus: 'unavailable',
          faucetAvailable: false,
        },
      },
    })
  })
  await page.route('**/api/sandbox/oidc/token', async (route) => {
    tokenExchange = await route.request().postDataJSON()
    await new Promise((resolve) => setTimeout(resolve, 150))
    exchangeComplete = true
    await route.fulfill({
      json: {
        access_token: 'sandbox-access-token',
        refresh_token: 'rotated-shared-refresh-token',
        expires_in: 3600,
      },
    })
  })
  await page.route('https://fa.test/api/auth/.well-known/openid-configuration', (route) => {
    if (!observeDiscovery) return route.fallback()
    discoveryRequested = true
    return route.abort()
  })
  const walletNavigations: Array<{ path: string; exchangeComplete: boolean }> = []
  page.on('framenavigated', (frame) => {
    const url = new URL(frame.url())
    if (frame === page.mainFrame() && url.origin === 'http://localhost:6230') {
      walletNavigations.push({ path: url.pathname, exchangeComplete })
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('agent-wallet.refresh_token', 'production-refresh-token')
  })
  observeDiscovery = true
  await page.getByRole('link', { name: 'Sandbox' }).click()
  await expect(page.getByText('Loading your wallet…')).toBeVisible()
  await page.waitForURL('http://localhost:6230/sandbox')
  await expect(page.getByText('Loading your wallet…')).toBeVisible()
  await expect(page.locator('.dashboard-skeleton')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()

  expect(tokenExchange).toEqual({
    grantType: 'refresh_token',
    refreshToken: 'production-refresh-token',
  })
  expect(discoveryRequested).toBe(false)
  expect(walletNavigations.filter(({ path }) => path === '/sandbox')).toEqual([
    { path: '/sandbox', exchangeComplete: true },
  ])
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('agent-wallet.sandbox.access_token')))
    .toBe('sandbox-access-token')
  expect(
    await page.evaluate(() => localStorage.getItem('agent-wallet.session.refresh_token')),
  ).toBe('rotated-shared-refresh-token')
})

test('signs out of both Wallet environments', async ({ page }) => {
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

  await expect.poll(() => revokedTokens.sort()).toEqual([
    'production-refresh-token',
    'sandbox-refresh-token',
  ])
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.startsWith('agent-wallet')),
    ),
  ).toEqual([])
})
