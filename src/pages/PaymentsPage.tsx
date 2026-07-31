import type { PublicConfig } from '../auth'
import { Payments } from '../features/dashboard/DashboardComponents'
import { TransitionScreen } from '../components/TransitionScreen'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { PageError } from './DashboardPage'

export function PaymentsPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const overview = dashboard.overview.data

  if (dashboard.overview.isPending) {
    return <TransitionScreen message="Loading your wallet…" />
  }

  return (
    <ConsoleLayout config={config} email={overview?.user.email}>
      <PageHeading
        eyebrow="Money movement"
        title="Payments"
        description="Inspect signed x402 authorizations, settlement status, merchants, and on-chain receipts."
      />
      <PageError error={dashboard.overview.error} />
      {overview ? <Payments config={config} overview={overview} page /> : null}
    </ConsoleLayout>
  )
}
