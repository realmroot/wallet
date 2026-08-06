import { actOnWallet, requestFaucet } from '../api'
import type { PublicConfig } from '../auth'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { TransitionScreen } from '../components/TransitionScreen'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { delegationNeedsRenewal } from '../lib/format'
import { PageError } from './DashboardPage'
import { Copy, Droplets, ExternalLink, KeyRound, Pause, Play, ShieldCheck, UserRound, WalletCards } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { blockExplorerAddressUrl, selectedNetwork, walletMode } from '../environment'
import { ProvisionWallet } from '../cdp'

export function SettingsPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const [copied, setCopied] = useState(false)
  const overview = dashboard.overview.data
  const user = overview?.user
  const account = overview?.runtime.account
  const evmAccount = user?.accounts.find((candidate) => candidate.family === 'evm')
  const solanaAccount = user?.accounts.find((candidate) => candidate.family === 'solana')
  const network = selectedNetwork(config)
  const error = dashboard.overview.error ?? dashboard.action.error

  async function copyAddress(address: string) {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  if (dashboard.overview.isPending) {
    return <TransitionScreen message="Loading your wallet…" />
  }

  return (
    <ConsoleLayout config={config} email={user?.email}>
      <PageHeading
        eyebrow="Wallet configuration"
        title="Settings"
        description="Manage the wallet account, delegated signing permission, funding, and emergency controls."
      />
      <PageError error={error} />
      {overview ? (
        <div className="settings-grid">
          <SettingsCard icon={<WalletCards size={19} />} title="Selected network">
            <SettingsRow label="Wallet mode" value={walletMode === 'sandbox' ? 'Sandbox' : 'Production'} />
            <SettingsRow label="Network" value={network.name} />
            <SettingsRow label="Account family" value={network.family === 'evm' ? 'EVM' : 'Solana'} />
            <SettingsRow
              label="Address"
              value={account?.address ?? 'Not provisioned'}
              actions={account?.address ? (
                <>
                  <button className="icon-button" onClick={() => void copyAddress(account.address)} aria-label="Copy address">
                    {copied ? <ShieldCheck size={17} /> : <Copy size={17} />}
                  </button>
                  {blockExplorerAddressUrl(network.id, account.address) ? (
                    <a className="icon-button" href={blockExplorerAddressUrl(network.id, account.address)!} target="_blank" rel="noreferrer" aria-label="View wallet in the block explorer">
                      <ExternalLink size={17} />
                    </a>
                  ) : null}
                </>
              ) : undefined}
            />
            <p className="settings-help">
              {accountFamilyDescription(config, network.family)}
            </p>
            {!account?.address ? (
              <p className="settings-help">
                Set up the {network.family === 'evm' ? 'EVM' : 'Solana'} account under Wallet accounts.
              </p>
            ) : null}
          </SettingsCard>

          <SettingsCard icon={<WalletCards size={19} />} title="Wallet accounts">
            <p className="settings-help">
              Account families are global and do not change with the Network view selector.
            </p>
            <SettingsRow
              label="EVM"
              value={evmAccount?.address ?? 'Not set up'}
              mono={Boolean(evmAccount)}
              actions={!evmAccount && config.cdpProjectId ? (
                <ProvisionWallet
                  config={config}
                  family="evm"
                  onComplete={dashboard.reload}
                />
              ) : undefined}
            />
            <SettingsRow
              label="Solana"
              value={solanaAccount?.address ?? 'Not set up'}
              mono={Boolean(solanaAccount)}
              actions={!solanaAccount && config.cdpProjectId ? (
                <ProvisionWallet
                  config={config}
                  family="solana"
                  onComplete={dashboard.reload}
                />
              ) : undefined}
            />
            {!config.cdpProjectId ? (
              <p className="settings-help">Configure CDP to provision wallet accounts.</p>
            ) : null}
          </SettingsCard>

          <SettingsCard icon={<KeyRound size={19} />} title="Signing delegation">
            <SettingsRow
              label="Status"
              value={account?.delegationExpiresAt
                ? `Active until ${new Date(account.delegationExpiresAt).toLocaleString()}`
                : 'Inactive'}
            />
            {account?.address && delegationNeedsRenewal(account.delegationExpiresAt) ? (
              config.cdpProjectId
                ? (
                    <ProvisionWallet
                      config={config}
                      family={network.family}
                      onComplete={dashboard.reload}
                      renewal
                    />
                  )
                : <p className="settings-help error">CDP must be configured to renew signing permission.</p>
            ) : null}
          </SettingsCard>

          <SettingsCard icon={<UserRound size={19} />} title="Identity">
            <SettingsRow label="Email" value={user?.email ?? 'Not provided'} />
            <SettingsRow label="OIDC subject" value={user?.subject ?? 'Unavailable'} mono />
            <SettingsRow label="Issuer" value={user?.issuer ?? config.oidcIssuer} mono />
          </SettingsCard>

          {walletMode === 'sandbox' ? (
            <SettingsCard icon={<Droplets size={19} />} title="Testnet funding">
              <p className="settings-help">
                {overview.runtime.faucetAssets.length > 0
                  ? `Request ${network.name} test assets for x402 validation.`
                  : `${network.name} is not available from the CDP faucet. Fund this account from an external testnet faucet.`}
              </p>
              {overview.runtime.faucetAssets.length > 0 ? (
                <div className="settings-actions">
                  {overview.runtime.faucetAssets.map((asset) => (
                    <button
                      className="secondary-button"
                      disabled={!account?.address || dashboard.busy(`faucet-${asset}`)}
                      key={asset}
                      onClick={() => void dashboard.run(
                        `faucet-${asset}`,
                        () => requestFaucet(config, { network: network.id, asset }),
                      )}
                    >
                      <Droplets size={16} /> Get test {asset === 'native' ? network.nativeSymbol : 'USDC'}
                    </button>
                  ))}
                </div>
              ) : null}
            </SettingsCard>
          ) : null}

          <SettingsCard icon={<ShieldCheck size={19} />} title="Emergency control" danger>
            <p className="settings-help">
              Immediately block new Agent payment authorizations. Existing signed authorizations may still settle.
            </p>
            <button
              className={user?.pausedAt ? 'primary-button' : 'danger-button'}
              disabled={user?.accounts.length === 0 || dashboard.busy('wallet-state')}
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
