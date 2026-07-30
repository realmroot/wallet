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
    localStorage.setItem('agent-wallet.access_token', 'browser-test-token')
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
  await expect(page.getByText('Local Codex')).toBeVisible()
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
})
