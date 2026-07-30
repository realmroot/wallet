import type { AgentGrant, BudgetRequestDetail, UpdateGrantInput, WalletOverview } from '../shared/contracts'
import {
  actOnWallet,
  actOnGrant,
  decideBudgetRequest,
  getOverview,
  inspectBudgetRequest,
  requestFaucet,
  revokeGrant,
  updateGrant,
} from './api'
import { beginLogin, completeLogin, hasToken, loadConfig, logout, type PublicConfig } from './auth'
import { lazy, Suspense, useEffect, useState } from 'react'

const CdpProvider = lazy(() => import('./cdp').then((module) => ({ default: module.CdpProvider })))
const ProvisionWallet = lazy(() =>
  import('./cdp').then((module) => ({ default: module.ProvisionWallet })),
)

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
  const [editingGrant, setEditingGrant] = useState<AgentGrant | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  async function reload() {
    setOverview(await getOverview(config))
  }

  async function runAction(key: string, action: () => Promise<void>) {
    setBusyAction(key)
    setError(null)
    try {
      await action()
      await reload()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet operation failed.')
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    void reload().catch((cause) => setError(cause instanceof Error ? cause.message : 'Wallet failed to load.'))
  }, [])

  return (
    <Suspense fallback={<main className="center">Loading wallet…</main>}>
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
              try {
                await logout(config)
              } finally {
                location.reload()
              }
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
                {overview.user.walletAddress ? (
                  <div className="inline-actions">
                    <button
                      className="text-button"
                      onClick={() => navigator.clipboard.writeText(overview.user.walletAddress!)}
                    >
                      Copy address
                    </button>
                    <a
                      href={`https://sepolia.basescan.org/address/${overview.user.walletAddress}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View on BaseScan
                    </a>
                  </div>
                ) : null}
              </div>
              <div>
                <p className="label">Signing delegation</p>
                <strong>
                  {overview.user.delegationExpiresAt
                    ? `Until ${new Date(overview.user.delegationExpiresAt).toLocaleDateString()}`
                    : 'Inactive'}
                </strong>
              </div>
              <div className="balance-list">
                <p className="label">Balances</p>
                {overview.runtime.balanceStatus === 'unavailable' ? (
                  <strong>Temporarily unavailable</strong>
                ) : overview.runtime.balances.length > 0 ? (
                  overview.runtime.balances.map((balance) => (
                    <strong key={balance.symbol}>{formatToken(balance.amount, balance.decimals)} {balance.symbol}</strong>
                  ))
                ) : (
                  <strong>—</strong>
                )}
              </div>
              {overview.runtime.faucetAvailable && overview.user.walletAddress ? (
                <div className="faucet-actions">
                  <p className="label">Testnet funds</p>
                  <div className="inline-actions">
                    {(['usdc', 'eth'] as const).map((token) => (
                      <button
                        className="ghost small"
                        disabled={busyAction === `faucet-${token}`}
                        key={token}
                        onClick={() =>
                          runAction(`faucet-${token}`, async () => {
                            await requestFaucet(config, { token })
                          })
                        }
                      >
                        Get test {token.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {overview.user.walletAddress ? (
                <div className="wallet-actions">
                  <p className="label">Emergency control</p>
                  <button
                    className={overview.user.pausedAt ? 'ghost small' : 'danger-link'}
                    disabled={busyAction === 'wallet-state'}
                    onClick={() =>
                      runAction('wallet-state', () =>
                        actOnWallet(config, { action: overview.user.pausedAt ? 'resume' : 'pause' }),
                      )
                    }
                  >
                    {overview.user.pausedAt ? 'Resume Agent payments' : 'Pause all Agent payments'}
                  </button>
                </div>
              ) : null}
            </section>
            {overview.user.pausedAt ? (
              <div className="notice error">
                Agent payments are paused for this Wallet. Existing on-chain authorizations may still settle.
              </div>
            ) : null}

            {!overview.user.walletAddress ? (
              config.cdpProjectId ? (
                <ProvisionWallet config={config} onComplete={reload} />
              ) : (
                <div className="notice">Configure a CDP project to provision the wallet from this browser.</div>
              )
            ) : null}
            {overview.user.walletAddress && delegationNeedsRenewal(overview.user.delegationExpiresAt) ? (
              config.cdpProjectId ? (
                <ProvisionWallet config={config} onComplete={reload} renewal />
              ) : (
                <div className="notice error">Signing delegation expired or expires soon. Ask the operator to configure CDP renewal.</div>
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
                New Agents request a budget through the Wallet API. You approve it on a dedicated confirmation page.
              </p>
              <div className="grid">
                {overview.grants.map((grant) => (
                  <article className="grant-card" key={grant.id}>
                    <div className="row">
                      <strong>{grant.name}</strong>
                      <span className={grant.revokedAt ? 'status revoked' : grant.pausedAt ? 'status paused' : 'status'}>
                        {grant.revokedAt ? 'Revoked' : grant.pausedAt ? 'Paused' : 'Active'}
                      </span>
                    </div>
                    <code>{grant.agentSubject}</code>
                    <p className="amount">
                      {formatUsdc(BigInt(grant.spentTotal))} <span>of {formatUsdc(BigInt(grant.totalLimit))}</span>
                    </p>
                    <p className="muted">Per payment {formatUsdc(BigInt(grant.perTransactionLimit))}</p>
                    <p className="muted">
                      {grant.allowedOrigins.length > 0
                        ? `${grant.allowedOrigins.length} allowed merchant ${grant.allowedOrigins.length === 1 ? 'origin' : 'origins'}`
                        : 'Any merchant origin'}
                      {' · '}
                      {grant.allowedRecipients.length > 0
                        ? `${grant.allowedRecipients.length} allowed ${grant.allowedRecipients.length === 1 ? 'recipient' : 'recipients'}`
                        : 'Any recipient'}
                    </p>
                    <p className="muted">
                      {grant.expiresAt ? `Expires ${new Date(grant.expiresAt).toLocaleDateString()}` : 'No expiration'}
                    </p>
                    {!grant.revokedAt ? (
                      <div className="grant-actions">
                        <button className="text-button" onClick={() => setEditingGrant(grant)}>Edit</button>
                        <button
                          className="text-button"
                          disabled={busyAction === `grant-${grant.id}`}
                          onClick={() =>
                            runAction(`grant-${grant.id}`, () =>
                              actOnGrant(config, grant.id, { action: grant.pausedAt ? 'resume' : 'pause' }),
                            )
                          }
                        >
                          {grant.pausedAt ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          className="danger-link"
                          disabled={busyAction === `revoke-${grant.id}`}
                          onClick={() => runAction(`revoke-${grant.id}`, () => revokeGrant(config, grant.id))}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </article>
                ))}
                {overview.grants.length === 0 ? (
                  <div className="empty-state">No Agent budgets yet. An Agent can request one through the Wallet API.</div>
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
                      {payment.error ? <p className="payment-error">{payment.error}</p> : null}
                    </div>
                    <span title={payment.error ?? undefined}>{payment.status}</span>
                    <strong>{formatUsdc(BigInt(payment.amount))}</strong>
                    {payment.transactionHash ? (
                      <a
                        className="tx-link"
                        href={`https://sepolia.basescan.org/tx/${payment.transactionHash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Receipt
                      </a>
                    ) : null}
                  </div>
                ))}
                {overview.payments.length === 0 ? <div className="empty-state">No payments yet.</div> : null}
              </div>
            </section>

            <section>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Security history</p>
                  <h2>Activity</h2>
                </div>
              </div>
              <div className="table">
                {overview.auditEvents.map((event) => (
                  <div className="activity-row" key={event.id}>
                    <div>
                      <strong>{eventLabel(event.action)}</strong>
                      <p>{new Date(event.createdAt).toLocaleString()}</p>
                    </div>
                    <code>{event.actorKind}</code>
                    <span>{event.targetType}</span>
                  </div>
                ))}
                {overview.auditEvents.length === 0 ? (
                  <div className="empty-state">No account activity yet.</div>
                ) : null}
              </div>
            </section>
          </>
        )}
        {editingGrant ? (
          <GrantDialog
            grant={editingGrant}
            busy={busyAction === `edit-${editingGrant.id}`}
            onClose={() => setEditingGrant(null)}
            onSave={(input) =>
              runAction(`edit-${editingGrant.id}`, async () => {
                await updateGrant(config, editingGrant.id, input)
                setEditingGrant(null)
              })
            }
          />
        ) : null}
        </main>
      </CdpProvider>
    </Suspense>
  )
}

function GrantDialog({
  grant,
  busy,
  onClose,
  onSave,
}: {
  grant: AgentGrant
  busy: boolean
  onClose: () => void
  onSave: (input: UpdateGrantInput) => Promise<void>
}) {
  return (
    <div className="backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="grant-dialog-title"
        onSubmit={async (event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const periodKind = String(data.get('periodKind')) as UpdateGrantInput['periodKind']
          await onSave({
            name: String(data.get('name')),
            totalLimit: toAtomic(String(data.get('totalLimit'))),
            perTransactionLimit: toAtomic(String(data.get('perTransactionLimit'))),
            periodKind,
            periodLimit: periodKind === 'none' ? null : toAtomic(String(data.get('periodLimit'))),
            allowedOrigins: parseOrigins(String(data.get('allowedOrigins'))),
            allowedRecipients: parseRecipients(String(data.get('allowedRecipients'))),
            expiresAt: toIsoDateTime(String(data.get('expiresAt'))),
          })
        }}
      >
        <p className="eyebrow">Agent budget</p>
        <h2 id="grant-dialog-title">Edit spending rules</h2>
        <label>
          Name
          <input name="name" required defaultValue={grant.name} />
        </label>
        <div className="field-grid">
          <label>
            Total USDC
            <input name="totalLimit" type="number" min="0.000001" step="0.000001" required defaultValue={fromAtomic(grant.totalLimit)} />
          </label>
          <label>
            Per payment
            <input name="perTransactionLimit" type="number" min="0.000001" step="0.000001" required defaultValue={fromAtomic(grant.perTransactionLimit)} />
          </label>
        </div>
        <label>
          Allowed merchant origins
          <textarea
            name="allowedOrigins"
            rows={3}
            placeholder="https://api.example.com&#10;Leave empty to allow any merchant"
            defaultValue={grant.allowedOrigins.join('\n')}
          />
        </label>
        <label>
          Allowed recipient addresses
          <textarea
            name="allowedRecipients"
            rows={3}
            placeholder="0x…&#10;Leave empty to allow any recipient"
            defaultValue={grant.allowedRecipients.join('\n')}
          />
        </label>
        <label>
          Authorization expires
          <input
            name="expiresAt"
            type="datetime-local"
            min={toDateTimeLocal(new Date())}
            defaultValue={grant.expiresAt ? toDateTimeLocal(new Date(grant.expiresAt)) : ''}
          />
        </label>
        <div className="field-grid">
          <label>
            Reset period
            <select name="periodKind" defaultValue={grant.periodKind}>
              <option value="daily">Daily</option>
              <option value="monthly">Monthly</option>
              <option value="none">No periodic limit</option>
            </select>
          </label>
          <label>
            Period limit (USDC)
            <input name="periodLimit" type="number" min="0.000001" step="0.000001" defaultValue={grant.periodLimit ? fromAtomic(grant.periodLimit) : '1'} />
          </label>
        </div>
        <div className="approval-actions">
          <button className="ghost" type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Save rules'}</button>
        </div>
      </form>
    </div>
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
    void inspectBudgetRequest(config, requestId, approvalToken)
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
          <p className="muted">You can close this page and return to the Agent.</p>
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
            const periodKind = String(data.get('periodKind'))
            if (!['none', 'daily', 'monthly'].includes(periodKind)) {
              throw new Error('Reset period is invalid.')
            }
            await decideBudgetRequest(config, request.id, {
              decision: 'approve',
              approvalToken,
              name: String(data.get('name')),
              totalLimit: toAtomic(String(data.get('totalLimit'))),
              perTransactionLimit: toAtomic(String(data.get('perTransactionLimit'))),
              periodKind: periodKind as 'none' | 'daily' | 'monthly',
              periodLimit:
                data.get('periodKind') === 'none' ? null : toAtomic(String(data.get('periodLimit'))),
              allowedOrigins: parseOrigins(String(data.get('allowedOrigins'))),
              allowedRecipients: parseRecipients(String(data.get('allowedRecipients'))),
              expiresAt: toIsoDateTime(String(data.get('expiresAt'))),
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
        <label>
          Allowed merchant origins
          <textarea
            name="allowedOrigins"
            rows={3}
            placeholder="https://api.example.com&#10;Leave empty to allow any merchant"
          />
        </label>
        <label>
          Allowed recipient addresses
          <textarea
            name="allowedRecipients"
            rows={3}
            placeholder="0x…&#10;Leave empty to allow any recipient"
          />
        </label>
        <label>
          Authorization expires
          <input
            name="expiresAt"
            type="datetime-local"
            min={toDateTimeLocal(new Date())}
            defaultValue={toDateTimeLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))}
            required
          />
        </label>
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
              await decideBudgetRequest(config, request.id, { decision: 'deny', approvalToken })
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

function formatToken(amount: string, decimals: number) {
  if (decimals === 0) return amount
  const normalized = amount.padStart(decimals + 1, '0')
  const whole = normalized.slice(0, -decimals) || '0'
  const fraction = normalized.slice(-decimals).replace(/0+$/, '').slice(0, 6)
  return `${whole}${fraction ? `.${fraction}` : ''}`
}

function fromAtomic(value: string) {
  return formatToken(value, 6)
}

function parseOrigins(value: string) {
  return splitLines(value).map((entry) => new URL(entry).origin)
}

function parseRecipients(value: string) {
  const recipients = splitLines(value).map((entry) => entry.toLowerCase())
  for (const recipient of recipients) {
    if (!/^0x[0-9a-f]{40}$/.test(recipient)) throw new Error(`Invalid recipient address: ${recipient}`)
  }
  return recipients
}

function splitLines(value: string) {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean))]
}

function toIsoDateTime(value: string) {
  return value ? new Date(value).toISOString() : null
}

function toDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function delegationNeedsRenewal(expiresAt: string | null) {
  if (!expiresAt) return true
  return new Date(expiresAt).getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000
}

function eventLabel(action: string) {
  return action
    .split('.')
    .join(' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
