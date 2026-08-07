import { actOnWallet } from '../api'
import type { PublicConfig } from '../auth'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { TransitionScreen } from '../components/TransitionScreen'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { delegationNeedsRenewal } from '../lib/format'
import { PageError } from './DashboardPage'
import { Copy, ExternalLink, KeyRound, Pause, Play, ShieldCheck, WalletCards } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { blockExplorerAddressUrl, selectedNetwork } from '../environment'
import { ProvisionWallet } from '../cdp'

export function AccountsPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null)
  const overview = dashboard.overview.data
  const user = overview?.user
  const account = overview?.runtime.account
  const evmAccount = user?.accounts.find((candidate) => candidate.family === 'evm')
  const solanaAccount = user?.accounts.find((candidate) => candidate.family === 'solana')
  const network = selectedNetwork(config)
  const error = dashboard.overview.error ?? dashboard.action.error

  async function copyAddress(address: string) {
    await navigator.clipboard.writeText(address)
    setCopiedAddress(address)
    window.setTimeout(() => setCopiedAddress(null), 1800)
  }

  if (dashboard.overview.isPending) {
    return <TransitionScreen message="Loading your wallet…" />
  }

  return (
    <ConsoleLayout config={config} email={user?.email}>
      <PageHeading
        title="Wallet accounts"
        description="Manage chain accounts, signing permission, and wallet-wide payment controls."
      />
      <PageError error={error} />
      {overview ? (
        <div className="settings-page">
          <section className="settings-card wallet-accounts-card">
            <SettingsCardHeading
              icon={<WalletCards size={18} />}
              title="Wallet accounts"
              description="One account per chain family. Compatible EVM networks share the same address."
            />
            <div className="settings-card-content">
              <SettingsRow
                label="EVM account"
                value={evmAccount?.address ?? 'Not set up'}
                mono={Boolean(evmAccount)}
                actions={evmAccount ? (
                  <AccountActions
                    address={evmAccount.address}
                    copied={copiedAddress === evmAccount.address}
                    explorerUrl={network.family === 'evm' ? blockExplorerAddressUrl(network.id, evmAccount.address) : null}
                    onCopy={copyAddress}
                  />
                ) : config.cdpProjectId ? <ProvisionWallet config={config} family="evm" onComplete={dashboard.reload} /> : undefined}
              />
              <SettingsRow
                label="Solana account"
                value={solanaAccount?.address ?? 'Not set up'}
                mono={Boolean(solanaAccount)}
                actions={solanaAccount ? (
                  <AccountActions
                    address={solanaAccount.address}
                    copied={copiedAddress === solanaAccount.address}
                    explorerUrl={network.family === 'solana' ? blockExplorerAddressUrl(network.id, solanaAccount.address) : null}
                    onCopy={copyAddress}
                  />
                ) : config.cdpProjectId ? <ProvisionWallet config={config} family="solana" onComplete={dashboard.reload} /> : undefined}
              />
              {!config.cdpProjectId ? <p className="settings-help">Configure CDP to provision wallet accounts.</p> : null}
              <p className="settings-help">{accountFamilyDescription(config, network.family)}</p>
            </div>
          </section>

          <section className="settings-card signing-permission-card">
              <SettingsCardHeading
                icon={<KeyRound size={18} />}
                title="Signing permission"
                description="Allows approved Agents to sign payments within their assigned budgets."
              />
              <div className="settings-card-content">
                <SettingsRow
                  label="Status"
                  value={account?.delegationExpiresAt
                    ? `Active until ${new Date(account.delegationExpiresAt).toLocaleString()}`
                    : 'Inactive'}
                  status={account?.delegationExpiresAt ? 'active' : 'inactive'}
                />
                {account?.address && delegationNeedsRenewal(account.delegationExpiresAt) ? (
                  config.cdpProjectId
                    ? <ProvisionWallet config={config} family={network.family} onComplete={dashboard.reload} renewal />
                    : <p className="settings-help error">CDP must be configured to renew signing permission.</p>
                ) : null}
              </div>
          </section>

          <section className="settings-danger-zone">
            <div className="settings-section-intro">
              <span className="settings-section-icon"><ShieldCheck size={18} /></span>
              <div>
                <h2>Emergency control</h2>
                <p>Stop new Agent payment authorizations across every network and account.</p>
              </div>
            </div>
            <div className="settings-danger-action">
              <p>Existing signed authorizations may still settle. You can resume payments at any time.</p>
              <button
                className={user?.pausedAt ? 'primary-button' : 'danger-button'}
                disabled={user?.accounts.length === 0 || dashboard.busy('wallet-state')}
                onClick={() => void dashboard.run('wallet-state', () =>
                  actOnWallet(config, { action: user?.pausedAt ? 'resume' : 'pause' }))}
              >
                {user?.pausedAt ? <Play size={16} /> : <Pause size={16} />}
                {user?.pausedAt ? 'Resume Agent payments' : 'Pause all Agent payments'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </ConsoleLayout>
  )
}

function accountFamilyDescription(
  config: PublicConfig,
  family: 'evm' | 'solana',
) {
  const networks = config.networks
    .filter((network) => network.family === family)
    .map((network) => network.name)
  if (family === 'solana') {
    return `This Solana account is used for ${networks.join(' and ')} and remains separate from the EVM account.`
  }
  return `The same EVM address is shared by ${formatList(networks)}. Balances and activity remain network-specific.`
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? 'this network'
  if (values.length === 2) return values.join(' and ')
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function SettingsCardHeading({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="settings-section-intro">
      <span className="settings-section-icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  )
}

function AccountActions({
  address,
  copied,
  explorerUrl,
  onCopy,
}: {
  address: string
  copied: boolean
  explorerUrl: string | null
  onCopy: (address: string) => Promise<void>
}) {
  return (
    <>
      <button
        className="icon-button"
        onClick={() => void onCopy(address)}
        aria-label={copied ? 'Address copied' : 'Copy address'}
        aria-live="polite"
      >
        {copied ? <ShieldCheck size={17} /> : <Copy size={17} />}
      </button>
      {explorerUrl ? (
        <a className="icon-button" href={explorerUrl} target="_blank" rel="noreferrer" aria-label="View wallet in the block explorer">
          <ExternalLink size={17} />
        </a>
      ) : null}
    </>
  )
}

function SettingsRow({
  label,
  value,
  actions,
  mono = false,
  status,
}: {
  label: string
  value: string
  actions?: ReactNode
  mono?: boolean
  status?: 'active' | 'inactive'
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong className={`${mono ? 'mono-value ' : ''}${status ? `setting-status ${status}` : ''}`.trim()}>{value}</strong>
      {actions ? <div className="compact-actions">{actions}</div> : null}
    </div>
  )
}
