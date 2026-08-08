import type { AgentGrant, WalletOverview as WalletOverviewData } from '../../../shared/contracts'
import { actOnGrant, deleteGrant } from '../../api'
import type { PublicConfig } from '../../auth'
import { ProvisionWallet } from '../../cdp'
import { useAgentProfile } from '../../agent-profile'
import { DeleteGrantDialog } from '../grants/DeleteGrantDialog'
import { blockExplorerAddressUrl, blockExplorerTransactionUrl } from '../../environment'
import { delegationNeedsRenewal, eventLabel, formatToken, formatUsdc } from '../../lib/format'
import {
  ArrowUpRight,
  Bot,
  Check,
  CircleDollarSign,
  Copy,
  Droplets,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  ShieldCheck,
  WalletCards,
} from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'wouter'

export function WalletOverview({
  config,
  overview,
  busy,
  fund,
  reload,
  copied,
  onCopy,
}: {
  config: PublicConfig
  overview: WalletOverviewData
  busy: (key: string) => boolean
  fund: (asset: 'usdc' | 'native') => Promise<unknown>
  reload: () => Promise<void>
  copied: boolean
  onCopy: (address: string) => Promise<void>
}) {
  const address = overview.runtime.account?.address ?? null
  const delegationExpiresAt = overview.runtime.account?.delegationExpiresAt ?? null
  const usdc = overview.runtime.balances.find((balance) => balance.symbol === 'USDC')
  const native = overview.runtime.balances.find((balance) => balance.assetAddress === null)
  const network = config.networks.find((candidate) => candidate.id === overview.runtime.network)
  const remainingBudget = overview.grants.reduce((sum, grant) => {
    const remaining = BigInt(grant.totalLimit) - BigInt(grant.spentTotal)
    return sum + (remaining > 0n ? remaining : 0n)
  }, 0n)

  return (
    <section className="overview-section" aria-labelledby="wallet-heading">
      <div className="wallet-overview-grid">
        <article className="wallet-balance-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker" id="wallet-heading">Available balance</span>
              <h2>{network?.name ?? 'Selected network'}</h2>
            </div>
            <span className={overview.runtime.balanceStatus === 'available' ? 'health-pill' : 'health-pill warning'}>
              {overview.runtime.balanceStatus === 'available' ? 'Live' : 'Unavailable'}
            </span>
          </div>
          <div className="primary-balance">
            <strong>{usdc ? formatToken(usdc.amount, usdc.decimals) : '—'}</strong>
            <span>USDC</span>
          </div>
          <div className="balance-supporting-metrics">
            <div>
              <WalletCards size={16} />
              <span>Network fee balance</span>
              <strong>{native ? `${formatToken(native.amount, native.decimals)} ${native.symbol}` : '—'}</strong>
            </div>
            <div>
              <CircleDollarSign size={16} />
              <span>Agent budget remaining</span>
              <strong>{formatUsdc(remainingBudget)}</strong>
            </div>
          </div>
          {address ? (
            <div className="address-block">
              <span className="address-icon"><WalletCards size={18} /></span>
              <div>
                <span>Settlement address</span>
                <code>{address}</code>
              </div>
              <div className="compact-actions">
                <button
                  className="icon-button"
                  onClick={() => void onCopy(address)}
                  aria-label={copied ? 'Address copied' : 'Copy address'}
                  aria-live="polite"
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </button>
                <a
                  className="icon-button"
                  href={blockExplorerAddressUrl(overview.runtime.network, address)!}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="View wallet in the block explorer"
                >
                  <ExternalLink size={17} />
                </a>
              </div>
            </div>
          ) : (
            <p className="empty-copy">
              Set up the {network?.family === 'evm' ? 'shared EVM' : 'Solana'} account to use {network?.name}.
            </p>
          )}
          {address && overview.runtime.faucetAssets.length > 0 ? (
            <div className="sandbox-actions" aria-label="Sandbox funding">
              <span>Sandbox tools</span>
              <div className="fund-actions">
                {overview.runtime.faucetAssets.map((asset) => (
                  <button
                    className="secondary-button"
                    disabled={busy(`faucet-${asset}`)}
                    key={asset}
                    onClick={() => void fund(asset)}
                  >
                    {busy(`faucet-${asset}`) ? <LoaderCircle className="button-spinner" size={16} /> : <Droplets size={16} />}
                    {busy(`faucet-${asset}`)
                      ? `Funding ${asset === 'native' ? network?.nativeSymbol : 'USDC'}…`
                      : `Get test ${asset === 'native' ? network?.nativeSymbol : 'USDC'}`}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="wallet-health-card">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Wallet health</span>
              <h2>Signing & safeguards</h2>
            </div>
            <span className={`security-orb${overview.user.pausedAt ? ' paused' : ''}`}>
              {overview.user.pausedAt ? <Pause size={20} /> : <ShieldCheck size={20} />}
            </span>
          </div>
          <div className="health-list">
            <Metric
              icon={<ShieldCheck size={17} />}
              label="Agent payments"
              value={overview.user.pausedAt ? 'Paused' : 'Enabled'}
              tone={overview.user.pausedAt ? 'warning' : 'success'}
            />
            <Metric
              icon={<KeyRound size={17} />}
              label="Signing permission"
              value={delegationExpiresAt
                ? `Until ${new Date(delegationExpiresAt).toLocaleDateString()}`
                : 'Inactive'}
              tone={delegationExpiresAt ? 'success' : 'muted'}
            />
            <Metric
              icon={<Bot size={17} />}
              label="Active Agents"
              value={String(overview.grants.length)}
              tone="muted"
            />
          </div>
          <Link className="secondary-button button-link health-settings-link" href="/accounts">
            Manage wallet accounts
            <ArrowUpRight size={15} />
          </Link>
        </article>
      </div>

      {overview.user.pausedAt ? (
        <div className="notice error overview-notice">
          <strong>Agent payments are paused</strong>
          <span>Existing on-chain authorizations may still settle.</span>
        </div>
      ) : null}
      {!address ? (
        config.cdpProjectId ? (
          <ProvisionWallet
            config={config}
            family={overview.runtime.family}
            onComplete={reload}
          />
        ) : (
          <div className="notice overview-notice">
            <strong>Wallet provisioning is unavailable</strong>
            <span>Configure a CDP project to provision this account.</span>
          </div>
        )
      ) : null}
      {address && delegationNeedsRenewal(delegationExpiresAt) ? (
        config.cdpProjectId ? (
          <ProvisionWallet
            config={config}
            family={overview.runtime.family}
            onComplete={reload}
            renewal
          />
        ) : (
          <div className="notice error overview-notice">
            <strong>Signing delegation needs renewal</strong>
            <span>Ask the operator to configure CDP renewal.</span>
          </div>
        )
      ) : null}
    </section>
  )
}

function Metric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode
  label: string
  value: string
  tone: 'success' | 'warning' | 'muted'
}) {
  return (
    <div className="health-row">
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
      <span className={`health-dot ${tone}`} />
    </div>
  )
}

export function AgentGrants({
  grants,
  config,
  busy,
  run,
  onEdit,
  compact = false,
  page = false,
}: {
  grants: AgentGrant[]
  config: PublicConfig
  busy: (key: string) => boolean
  run: (key: string, operation: () => Promise<unknown>) => Promise<unknown>
  onEdit: (grant: AgentGrant) => void
  compact?: boolean
  page?: boolean
}) {
  return (
    <section className={`records-section${page ? ' page-records' : ''}`} aria-label="Agent budgets">
      <div className={`agent-grid${compact ? ' compact-grid' : ''}`}>
        {grants.map((grant) => (
          <AgentGrantCard
            key={grant.id}
            grant={grant}
            config={config}
            busy={busy}
            run={run}
            onEdit={onEdit}
          />
        ))}
        {!grants.length ? (
          <div className="empty-state">
            <span className="surface-icon"><Bot size={20} /></span>
            <strong>No Agent budgets yet</strong>
            <p>An Agent can request one through the Wallet API.</p>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function AgentGrantCard({
  grant,
  config,
  busy,
  run,
  onEdit,
}: {
  grant: AgentGrant
  config: PublicConfig
  busy: (key: string) => boolean
  run: (key: string, operation: () => Promise<unknown>) => Promise<unknown>
  onEdit: (grant: AgentGrant) => void
}) {
  const agentProfile = useAgentProfile(grant.agentIssuer, grant.agentSubject).data
  const agentLabel = agentProfile?.name ?? grant.agentSubject
  const spent = BigInt(grant.spentTotal)
  const total = BigInt(grant.totalLimit)
  const progress = total > 0n ? Number((spent * 10_000n) / total) / 100 : 0
  const deleteKey = `delete-${grant.id}`

  return (
    <article className="agent-card">
      <div className="agent-card-header">
        <span className="agent-avatar">
          {agentProfile?.picture ? <img src={agentProfile.picture} alt="" /> : <Bot size={20} />}
        </span>
        <div className="agent-title">
          <h3>{agentLabel}</h3>
          <code>{grant.agentSubject}</code>
        </div>
        <span className={grant.pausedAt ? 'status paused' : 'status'}>
          <span />
          {grant.pausedAt ? 'Paused' : 'Active'}
        </span>
      </div>
      <div className="budget-row">
        <div>
          <span>Spent</span>
          <strong>{formatUsdc(spent)}</strong>
        </div>
        <div>
          <span>Total budget</span>
          <strong>{formatUsdc(total)}</strong>
        </div>
      </div>
      <div
        className="budget-progress"
        role="progressbar"
        aria-label={`${agentLabel} budget used`}
        aria-valuenow={Math.min(progress, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ '--progress': `${Math.min(progress, 100)}%` } as CSSProperties}
      >
        <span />
      </div>
      <div className="policy-list">
        <span>Per payment <strong>{formatUsdc(BigInt(grant.perTransactionLimit))}</strong></span>
        <span>{grant.allowedOrigins.length ? `${grant.allowedOrigins.length} merchant origins` : 'Any merchant origin'}</span>
        <span>{grant.expiresAt ? `Expires ${new Date(grant.expiresAt).toLocaleDateString()}` : 'No expiration'}</span>
      </div>
      <div className="agent-actions">
        <button className="quiet-button" onClick={() => onEdit(grant)}>
          <Pencil size={15} /> Edit
        </button>
        <button
          className="quiet-button"
          disabled={busy(`grant-${grant.id}`)}
          onClick={() =>
            void run(`grant-${grant.id}`, () =>
              actOnGrant(config, grant.id, { action: grant.pausedAt ? 'resume' : 'pause' }),
            )
          }
        >
          {grant.pausedAt ? <Play size={15} /> : <Pause size={15} />}
          {grant.pausedAt ? 'Resume' : 'Pause'}
        </button>
        <DeleteGrantDialog
          agentLabel={agentLabel}
          busy={busy(deleteKey)}
          onConfirm={() => run(deleteKey, () => deleteGrant(config, grant.id))}
        />
      </div>
    </article>
  )
}

export function Payments({
  config,
  overview,
  compact = false,
  page = false,
}: {
  config: PublicConfig
  overview: WalletOverviewData
  compact?: boolean
  page?: boolean
}) {
  return (
    <section className={`records-section${page ? ' page-records' : ''}`} aria-label="Payments">
      <div className={`data-table${compact ? ' compact-table' : ''}`} role="table" aria-label="Payments">
        <div className="data-row data-header" role="row">
          <span role="columnheader">Merchant</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Amount</span>
          <span role="columnheader">Receipt</span>
        </div>
        {overview.payments.map((payment) => (
          <div className="data-row" role="row" key={payment.id}>
            <div className="merchant-cell" role="cell">
              <span className="merchant-icon"><ArrowUpRight size={17} /></span>
              <div>
                <strong>{new URL(payment.resource).hostname}</strong>
                <small>{new Date(payment.createdAt).toLocaleString()}</small>
                {payment.error ? <small className="payment-error">{payment.error}</small> : null}
              </div>
            </div>
            <span className={`payment-status ${payment.status}`} role="cell">
              <span /> {payment.status}
            </span>
            <strong className="money-cell" role="cell">{formatUsdc(BigInt(payment.amount))}</strong>
            <div role="cell">
              {payment.transactionHash ? (
                <a
                  className="receipt-link"
                  href={blockExplorerTransactionUrl(payment.network, payment.transactionHash)!}
                  target="_blank"
                  rel="noreferrer"
                >
                  Receipt <ExternalLink size={14} />
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </div>
          </div>
        ))}
        {!overview.payments.length ? <div className="empty-state">No payments yet.</div> : null}
      </div>
    </section>
  )
}

export function Activity({ overview, page = false }: { overview: WalletOverviewData; page?: boolean }) {
  return (
    <section className={`records-section${page ? ' page-records' : ''}`} aria-label="Activity">
      <div className="activity-list">
        {overview.auditEvents.map((event) => (
          <div className="activity-item" key={event.id}>
            <span className="timeline-mark" />
            <div>
              <strong>{eventLabel(event.action)}</strong>
              <small>{new Date(event.createdAt).toLocaleString()}</small>
            </div>
            <span className="actor-badge">{event.actorKind}</span>
            <span className="target-label">{event.targetType}</span>
          </div>
        ))}
        {!overview.auditEvents.length ? <div className="empty-state">No account activity yet.</div> : null}
      </div>
    </section>
  )
}
