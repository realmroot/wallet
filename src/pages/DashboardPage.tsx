import type { PublicConfig } from '../auth'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import {
  AgentGrants,
  Payments,
  WalletOverview,
} from '../features/dashboard/DashboardComponents'
import { TransitionScreen } from '../components/TransitionScreen'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { useState } from 'react'
import { Link, useLocation } from 'wouter'
import { networkName } from '../environment'

export function DashboardPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const [, navigate] = useLocation()
  const [copied, setCopied] = useState(false)
  const overview = dashboard.overview.data
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
    <ConsoleLayout config={config} email={overview?.user.email}>
      <PageHeading
        eyebrow="Control plane"
        title="Overview"
        description="Your wallet, delegated budgets, and recent money movement at a glance."
        action={<span className="network-badge"><span /> {networkName(config.network)}</span>}
      />
      {!config.paymentsEnabled ? (
        <div className="notice" role="status">
          Production payments are not enabled yet. Wallet setup and policy review remain available.
        </div>
      ) : null}
      <PageError error={error} />
      {overview ? (
        <>
          <WalletOverview
            config={config}
            overview={overview}
            busy={dashboard.busy}
            run={dashboard.run}
            reload={dashboard.reload}
            copied={copied}
            onCopy={copyAddress}
          />
          <div className="overview-heading">
            <h2>Agent budgets</h2>
            <Link href="/agents">View all Agents</Link>
          </div>
          <AgentGrants
            grants={overview.grants.slice(0, 2)}
            busy={dashboard.busy}
            run={dashboard.run}
            config={config}
            onEdit={() => navigate('/agents')}
            compact
          />
          <div className="overview-heading">
            <h2>Recent payments</h2>
            <Link href="/payments">View all payments</Link>
          </div>
          <Payments config={config} overview={{ ...overview, payments: overview.payments.slice(0, 3) }} compact />
        </>
      ) : null}
    </ConsoleLayout>
  )
}

export function PageError({ error }: { error: Error | null }) {
  return error ? (
    <div className="notice error" role="alert">
      <strong>Wallet operation failed</strong>
      <span>{error.message}</span>
    </div>
  ) : null
}
