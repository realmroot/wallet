import type { AgentGrant, WalletOverview } from '../../shared/contracts'
import {
  actOnGrant,
  actOnWallet,
  getOverview,
  requestFaucet,
  revokeGrant,
  updateGrant,
} from '../api'
import type { PublicConfig } from '../auth'
import { logout } from '../auth'
import { GrantDialog } from '../features/grants/GrantDialog'
import { delegationNeedsRenewal, eventLabel, formatToken, formatUsdc } from '../lib/format'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useState } from 'react'

const CdpProvider = lazy(() => import('../cdp').then((module) => ({ default: module.CdpProvider })))
const ProvisionWallet = lazy(() =>
  import('../cdp').then((module) => ({ default: module.ProvisionWallet })),
)

export function DashboardPage({ config }: { config: PublicConfig }) {
  const queryClient = useQueryClient()
  const [editingGrant, setEditingGrant] = useState<AgentGrant | null>(null)
  const overviewQuery = useQuery({
    queryKey: ['wallet-overview'],
    queryFn: () => getOverview(config),
  })
  const action = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<unknown> }) => run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['wallet-overview'] })
    },
  })
  const busy = (key: string) => action.isPending && action.variables?.key === key
  const run = (key: string, operation: () => Promise<unknown>) => action.mutateAsync({ key, run: operation })
  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['wallet-overview'] })
  }
  const overview = overviewQuery.data
  const error = overviewQuery.error ?? action.error

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
                  location.assign('/')
                }
              }}
            >
              Sign out
            </button>
          </header>

          {error ? (
            <div className="notice error" role="alert">
              {error.message}
            </div>
          ) : null}
          {overviewQuery.isPending ? <div className="empty-state">Loading wallet…</div> : null}
          {overview ? (
            <>
              <WalletSummary
                config={config}
                overview={overview}
                busy={busy}
                run={run}
                reload={reload}
              />
              <AgentGrants
                grants={overview.grants}
                busy={busy}
                run={run}
                config={config}
                onEdit={setEditingGrant}
              />
              <Payments overview={overview} />
              <Activity overview={overview} />
            </>
          ) : null}
          {editingGrant ? (
            <GrantDialog
              grant={editingGrant}
              busy={busy(`edit-${editingGrant.id}`)}
              onClose={() => setEditingGrant(null)}
              onSave={async (input) => {
                await run(`edit-${editingGrant.id}`, () => updateGrant(config, editingGrant.id, input))
                setEditingGrant(null)
              }}
            />
          ) : null}
        </main>
      </CdpProvider>
    </Suspense>
  )
}

function WalletSummary({
  config,
  overview,
  busy,
  run,
  reload,
}: {
  config: PublicConfig
  overview: WalletOverview
  busy: (key: string) => boolean
  run: (key: string, operation: () => Promise<unknown>) => Promise<unknown>
  reload: () => Promise<void>
}) {
  const address = overview.user.walletAddress
  return (
    <>
      <section className="wallet-card" aria-labelledby="wallet-heading">
        <div>
          <p className="label" id="wallet-heading">Base Sepolia wallet</p>
          <strong>{address ?? 'Not provisioned'}</strong>
          {address ? (
            <div className="inline-actions">
              <button className="text-button" onClick={() => navigator.clipboard.writeText(address)}>
                Copy address
              </button>
              <a href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noreferrer">
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
          ) : overview.runtime.balances.length ? (
            overview.runtime.balances.map((balance) => (
              <strong key={balance.symbol}>
                {formatToken(balance.amount, balance.decimals)} {balance.symbol}
              </strong>
            ))
          ) : (
            <strong>—</strong>
          )}
        </div>
        {overview.runtime.faucetAvailable && address ? (
          <div className="faucet-actions">
            <p className="label">Testnet funds</p>
            <div className="inline-actions">
              {(['usdc', 'eth'] as const).map((token) => (
                <button
                  className="ghost small"
                  disabled={busy(`faucet-${token}`)}
                  key={token}
                  onClick={() => void run(`faucet-${token}`, () => requestFaucet(config, { token }))}
                >
                  Get test {token.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {address ? (
          <div className="wallet-actions">
            <p className="label">Emergency control</p>
            <button
              className={overview.user.pausedAt ? 'ghost small' : 'danger-link'}
              disabled={busy('wallet-state')}
              onClick={() =>
                void run('wallet-state', () =>
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
      {!address ? (
        config.cdpProjectId ? (
          <ProvisionWallet config={config} onComplete={reload} />
        ) : (
          <div className="notice">Configure a CDP project to provision the wallet from this browser.</div>
        )
      ) : null}
      {address && delegationNeedsRenewal(overview.user.delegationExpiresAt) ? (
        config.cdpProjectId ? (
          <ProvisionWallet config={config} onComplete={reload} renewal />
        ) : (
          <div className="notice error">
            Signing delegation expired or expires soon. Ask the operator to configure CDP renewal.
          </div>
        )
      ) : null}
    </>
  )
}

function AgentGrants({
  grants,
  config,
  busy,
  run,
  onEdit,
}: {
  grants: AgentGrant[]
  config: PublicConfig
  busy: (key: string) => boolean
  run: (key: string, operation: () => Promise<unknown>) => Promise<unknown>
  onEdit: (grant: AgentGrant) => void
}) {
  return (
    <section aria-labelledby="agents-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Delegated budgets</p>
          <h2 id="agents-heading">Agents</h2>
        </div>
      </div>
      <p className="muted section-copy">
        New Agents request a budget through the Wallet API. You approve it on a dedicated confirmation page.
      </p>
      <div className="grid">
        {grants.map((grant) => (
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
              {grant.allowedOrigins.length ? `${grant.allowedOrigins.length} allowed merchant origins` : 'Any merchant origin'}
              {' · '}
              {grant.allowedRecipients.length ? `${grant.allowedRecipients.length} allowed recipients` : 'Any recipient'}
            </p>
            <p className="muted">
              {grant.expiresAt ? `Expires ${new Date(grant.expiresAt).toLocaleDateString()}` : 'No expiration'}
            </p>
            {!grant.revokedAt ? (
              <div className="grant-actions">
                <button className="text-button" onClick={() => onEdit(grant)}>Edit</button>
                <button
                  className="text-button"
                  disabled={busy(`grant-${grant.id}`)}
                  onClick={() =>
                    void run(`grant-${grant.id}`, () =>
                      actOnGrant(config, grant.id, { action: grant.pausedAt ? 'resume' : 'pause' }),
                    )
                  }
                >
                  {grant.pausedAt ? 'Resume' : 'Pause'}
                </button>
                <button
                  className="danger-link"
                  disabled={busy(`revoke-${grant.id}`)}
                  onClick={() => void run(`revoke-${grant.id}`, () => revokeGrant(config, grant.id))}
                >
                  Revoke
                </button>
              </div>
            ) : null}
          </article>
        ))}
        {!grants.length ? (
          <div className="empty-state">No Agent budgets yet. An Agent can request one through the Wallet API.</div>
        ) : null}
      </div>
    </section>
  )
}

function Payments({ overview }: { overview: WalletOverview }) {
  return (
    <section aria-labelledby="payments-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Audit trail</p>
          <h2 id="payments-heading">Payments</h2>
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
        {!overview.payments.length ? <div className="empty-state">No payments yet.</div> : null}
      </div>
    </section>
  )
}

function Activity({ overview }: { overview: WalletOverview }) {
  return (
    <section aria-labelledby="activity-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Security history</p>
          <h2 id="activity-heading">Activity</h2>
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
        {!overview.auditEvents.length ? <div className="empty-state">No account activity yet.</div> : null}
      </div>
    </section>
  )
}
