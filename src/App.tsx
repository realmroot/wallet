import type { BudgetRequestDetail, WalletOverview } from '../shared/contracts'
import { api, beginLogin, completeLogin, hasToken, loadConfig, logout, type PublicConfig } from './auth'
import { CdpProvider, ProvisionWallet } from './cdp'
import { useEffect, useState } from 'react'

export function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const nextConfig = await loadConfig()
        setConfig(nextConfig)
        if (location.pathname === '/oidc/callback') {
          await completeLogin(nextConfig)
          setConfig({ ...nextConfig })
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Wallet failed to load.')
      }
    })()
  }, [])

  if (!config) return <main className="center">{error ?? 'Loading…'}</main>
  if (location.pathname === '/authorize') return <BudgetApprovalPage config={config} initialError={error} />
  if (!hasToken()) return <LoginPage config={config} error={error} />
  return <Dashboard config={config} initialError={error} />
}

function LoginPage({ config, error }: { config: PublicConfig; error: string | null }) {
  return (
    <main className="login">
      <div className="brand-mark">AW</div>
      <p className="eyebrow">OIDC-native payments</p>
      <h1>A wallet agents can use, under your rules.</h1>
      <p className="lede">One wallet per user. Explicit budgets per Agent. Standard x402 payments on Base.</p>
      <button className="primary" onClick={() => beginLogin(config)}>
        Continue with your identity provider
      </button>
      {error ? <p className="error">{error}</p> : null}
    </main>
  )
}

function Dashboard({ config, initialError }: { config: PublicConfig; initialError: string | null }) {
  const [overview, setOverview] = useState<WalletOverview | null>(null)
  const [error, setError] = useState<string | null>(initialError)

  async function reload() {
    setOverview(await api(config, '/api/overview'))
  }

  useEffect(() => {
    void reload().catch((cause) => setError(cause instanceof Error ? cause.message : 'Wallet failed to load.'))
  }, [])

  return (
    <CdpProvider config={config}>
      <main className="shell">
        <header>
          <div>
            <p className="eyebrow">Agent Wallet</p>
            <h1>Wallet control plane</h1>
          </div>
          <button
            className="ghost"
            onClick={async () => {
              await logout(config)
              location.reload()
            }}
          >
            Sign out
          </button>
        </header>

        {error ? <div className="notice error">{error}</div> : null}
        {!overview ? (
          <div className="empty-state">Loading wallet…</div>
        ) : (
          <>
            <section className="wallet-card">
              <div>
                <p className="label">Base Sepolia wallet</p>
                <strong>{overview.user.walletAddress ?? 'Not provisioned'}</strong>
              </div>
              <div>
                <p className="label">Signing delegation</p>
                <strong>
                  {overview.user.delegationExpiresAt
                    ? `Until ${new Date(overview.user.delegationExpiresAt).toLocaleDateString()}`
                    : 'Inactive'}
                </strong>
              </div>
            </section>

            {!overview.user.walletAddress ? (
              config.cdpProjectId ? (
                <ProvisionWallet config={config} onComplete={reload} />
              ) : (
                <div className="notice">Configure a CDP project to provision the wallet from this browser.</div>
              )
            ) : null}

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Delegated budgets</p>
                  <h2>Agents</h2>
                </div>
              </div>
              <p className="muted section-copy">
                New Agents request a budget from the Wallet CLI. You approve the request on its dedicated confirmation page.
              </p>
              <div className="grid">
                {overview.grants.map((grant) => (
                  <article className="grant-card" key={grant.id}>
                    <div className="row">
                      <strong>{grant.name}</strong>
                      <span className={grant.revokedAt ? 'status revoked' : 'status'}>
                        {grant.revokedAt ? 'Revoked' : 'Active'}
                      </span>
                    </div>
                    <code>{grant.agentSubject}</code>
                    <p className="amount">
                      {formatUsdc(BigInt(grant.spentTotal))} <span>of {formatUsdc(BigInt(grant.totalLimit))}</span>
                    </p>
                    <p className="muted">Per payment {formatUsdc(BigInt(grant.perTransactionLimit))}</p>
                    {!grant.revokedAt ? (
                      <button
                        className="danger-link"
                        onClick={async () => {
                          await api(config, `/api/grants/${grant.id}`, { method: 'DELETE' })
                          await reload()
                        }}
                      >
                        Revoke
                      </button>
                    ) : null}
                  </article>
                ))}
                {overview.grants.length === 0 ? (
                  <div className="empty-state">No Agent budgets yet. Run the Wallet CLI to request one.</div>
                ) : null}
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Audit trail</p>
                  <h2>Payments</h2>
                </div>
              </div>
              <div className="table">
                {overview.payments.map((payment) => (
                  <div className="payment-row" key={payment.id}>
                    <div>
                      <strong>{new URL(payment.resource).hostname}</strong>
                      <p>{new Date(payment.createdAt).toLocaleString()}</p>
                    </div>
                    <span>{payment.status}</span>
                    <strong>{formatUsdc(BigInt(payment.amount))}</strong>
                  </div>
                ))}
                {overview.payments.length === 0 ? <div className="empty-state">No payments yet.</div> : null}
              </div>
            </section>
          </>
        )}
      </main>
    </CdpProvider>
  )
}

function BudgetApprovalPage({ config, initialError }: { config: PublicConfig; initialError: string | null }) {
  const params = new URLSearchParams(location.hash.slice(1))
  const requestId = params.get('request')
  const approvalToken = params.get('token')
  const returnTo = `${location.pathname}${location.hash}`
  const [request, setRequest] = useState<BudgetRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [result, setResult] = useState<'approved' | 'denied' | null>(null)

  useEffect(() => {
    if (!hasToken() || !requestId || !approvalToken) return
    void api<BudgetRequestDetail>(
      config,
      `/api/budget-requests/${encodeURIComponent(requestId)}/inspect`,
      {
        method: 'POST',
        body: JSON.stringify({ approvalToken }),
      },
    )
      .then(setRequest)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Budget request failed to load.'))
  }, [config, requestId, approvalToken])

  if (!requestId || !approvalToken) {
    return <main className="center"><div className="notice error">This budget approval link is invalid.</div></main>
  }
  if (!hasToken()) {
    return (
      <main className="login compact">
        <div className="brand-mark">AW</div>
        <p className="eyebrow">Agent budget request</p>
        <h1>Review an Agent before it can spend.</h1>
        <button className="primary" onClick={() => beginLogin(config, returnTo)}>
          Sign in to review
        </button>
        {error ? <p className="error">{error}</p> : null}
      </main>
    )
  }
  if (result) {
    return (
      <main className="center">
        <div className="approval-card">
          <p className="eyebrow">Request {result}</p>
          <h2>{result === 'approved' ? 'The Agent can now use its budget.' : 'No budget was granted.'}</h2>
          <p className="muted">You can close this page and return to the CLI.</p>
          <a className="primary button-link" href="/">Open wallet</a>
        </div>
      </main>
    )
  }
  if (error) return <main className="center"><div className="notice error">{error}</div></main>
  if (!request) return <main className="center">Loading request…</main>
  if (request.status !== 'pending') {
    return <main className="center"><div className="notice">This request is already {request.status}.</div></main>
  }

  return (
    <main className="center approval-shell">
      <form
        className="approval-card"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          try {
            await api(config, `/api/budget-requests/${encodeURIComponent(request.id)}/decision`, {
              method: 'PUT',
              body: JSON.stringify({
                decision: 'approve',
                approvalToken,
                name: String(data.get('name')),
                totalLimit: toAtomic(String(data.get('totalLimit'))),
                perTransactionLimit: toAtomic(String(data.get('perTransactionLimit'))),
                periodKind: String(data.get('periodKind')),
                periodLimit:
                  data.get('periodKind') === 'none' ? null : toAtomic(String(data.get('periodLimit'))),
                expiresAt: null,
              }),
            })
            setResult('approved')
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Budget approval failed.')
          }
        }}
      >
        <p className="eyebrow">Agent budget request</p>
        <h2>Allow this Agent to spend?</h2>
        <div className="identity-card">
          <span>Agent identity</span>
          <code>{request.agentSubject}</code>
        </div>
        <label>
          Name
          <input name="name" required defaultValue={request.requestedName ?? 'Local Agent'} />
        </label>
        <div className="field-grid">
          <label>
            Total USDC
            <input name="totalLimit" type="number" min="0.001" step="0.001" required defaultValue="10" />
          </label>
          <label>
            Per payment
            <input name="perTransactionLimit" type="number" min="0.001" step="0.001" required defaultValue="1" />
          </label>
        </div>
        <div className="field-grid">
          <label>
            Reset period
            <select name="periodKind" defaultValue="daily">
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="none">No periodic limit</option>
            </select>
          </label>
          <label>
            Period limit (USDC)
            <input name="periodLimit" type="number" min="0.001" step="0.001" required defaultValue="3" />
          </label>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="approval-actions">
          <button
            className="ghost"
            type="button"
            onClick={async () => {
              await api(config, `/api/budget-requests/${encodeURIComponent(request.id)}/decision`, {
                method: 'PUT',
                body: JSON.stringify({ decision: 'deny', approvalToken }),
              })
              setResult('denied')
            }}
          >
            Deny
          </button>
          <button className="primary" type="submit">Authorize budget</button>
        </div>
      </form>
    </main>
  )
}

function toAtomic(value: string) {
  const [whole, fraction = ''] = value.split('.')
  return `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=\d)/, '')
}

function formatUsdc(value: bigint) {
  const whole = value / 1_000_000n
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '')
  return `$${whole}${fraction ? `.${fraction}` : ''}`
}
