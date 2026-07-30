import { actOnWallet, requestFaucet } from '../api'
import type { PublicConfig } from '../auth'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { DashboardSkeleton } from '../features/dashboard/DashboardComponents'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { delegationNeedsRenewal } from '../lib/format'
import { PageError } from './DashboardPage'
import { Copy, Droplets, ExternalLink, KeyRound, Pause, Play, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import { lazy, useState, type ReactNode } from 'react'

const ProvisionWallet = lazy(() => import('../cdp').then((module) => ({ default: module.ProvisionWallet })))

export function SettingsPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const [copied, setCopied] = useState(false)
  const overview = dashboard.overview.data
  const user = overview?.user
  const error = dashboard.overview.error ?? dashboard.action.error

  async function copyAddress(address: string) {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <ConsoleLayout config={config} email={user?.email}>
      <PageHeading
        eyebrow="Wallet configuration"
        title="Settings"
        description="Manage the wallet account, delegated signing permission, testnet funding, and emergency controls."
      />
      <PageError error={error} />
      {dashboard.overview.isPending ? <DashboardSkeleton /> : null}
      {overview ? (
        <div className="settings-grid">
          <SettingsCard icon={<WalletCards size={19} />} title="Wallet">
            <SettingsRow label="Network" value="Base Sepolia" />
            <SettingsRow
              label="Address"
              value={user?.walletAddress ?? 'Not provisioned'}
              actions={user?.walletAddress ? (
                <>
                  <button className="icon-button" onClick={() => void copyAddress(user.walletAddress!)} aria-label="Copy address">
                    {copied ? <ShieldCheck size={17} /> : <Copy size={17} />}
                  </button>
                  <a className="icon-button" href={`https://sepolia.basescan.org/address/${user.walletAddress}`} target="_blank" rel="noreferrer" aria-label="View wallet on BaseScan">
                    <ExternalLink size={17} />
                  </a>
                </>
              ) : undefined}
            />
            {!user?.walletAddress ? (
              config.cdpProjectId
                ? <ProvisionWallet config={config} onComplete={dashboard.reload} />
                : <p className="settings-help">Configure CDP to provision this wallet.</p>
            ) : null}
          </SettingsCard>

          <SettingsCard icon={<KeyRound size={19} />} title="Signing delegation">
            <SettingsRow
              label="Status"
              value={user?.delegationExpiresAt
                ? `Active until ${new Date(user.delegationExpiresAt).toLocaleString()}`
                : 'Inactive'}
            />
            {user?.walletAddress && delegationNeedsRenewal(user.delegationExpiresAt) ? (
              config.cdpProjectId
                ? <ProvisionWallet config={config} onComplete={dashboard.reload} renewal />
                : <p className="settings-help error">CDP must be configured to renew signing permission.</p>
            ) : null}
          </SettingsCard>

          <SettingsCard icon={<UserRound size={19} />} title="Identity">
            <SettingsRow label="Email" value={user?.email ?? 'Not provided'} />
            <SettingsRow label="OIDC subject" value={user?.subject ?? 'Unavailable'} mono />
            <SettingsRow label="Issuer" value={user?.issuer ?? config.oidcIssuer} mono />
          </SettingsCard>

          <SettingsCard icon={<Droplets size={19} />} title="Testnet funding">
            <p className="settings-help">Request test assets for Base Sepolia development and x402 validation.</p>
            <div className="settings-actions">
              {(['usdc', 'eth'] as const).map((token) => (
                <button
                  className="secondary-button"
                  disabled={!overview.runtime.faucetAvailable || !user?.walletAddress || dashboard.busy(`faucet-${token}`)}
                  key={token}
                  onClick={() => void dashboard.run(`faucet-${token}`, () => requestFaucet(config, { token }))}
                >
                  <Droplets size={16} /> Get test {token.toUpperCase()}
                </button>
              ))}
            </div>
          </SettingsCard>

          <SettingsCard icon={<ShieldCheck size={19} />} title="Emergency control" danger>
            <p className="settings-help">
              Immediately block new Agent payment authorizations. Existing signed authorizations may still settle.
            </p>
            <button
              className={user?.pausedAt ? 'primary-button' : 'danger-button'}
              disabled={!user?.walletAddress || dashboard.busy('wallet-state')}
              onClick={() =>
                void dashboard.run('wallet-state', () =>
                  actOnWallet(config, { action: user?.pausedAt ? 'resume' : 'pause' }),
                )
              }
            >
              {user?.pausedAt ? <Play size={16} /> : <Pause size={16} />}
              {user?.pausedAt ? 'Resume Agent payments' : 'Pause all Agent payments'}
            </button>
          </SettingsCard>
        </div>
      ) : null}
    </ConsoleLayout>
  )
}

function SettingsCard({
  icon,
  title,
  danger = false,
  children,
}: {
  icon: ReactNode
  title: string
  danger?: boolean
  children: ReactNode
}) {
  return (
    <section className={`settings-card${danger ? ' danger-zone' : ''}`}>
      <div className="settings-card-heading">
        <span className="surface-icon">{icon}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  )
}

function SettingsRow({
  label,
  value,
  actions,
  mono = false,
}: {
  label: string
  value: string
  actions?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong className={mono ? 'mono-value' : undefined}>{value}</strong>
      {actions ? <div className="compact-actions">{actions}</div> : null}
    </div>
  )
}
