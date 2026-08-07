import type { PublicConfig } from '../auth'
import { Activity } from '../features/dashboard/DashboardComponents'
import { TransitionScreen } from '../components/TransitionScreen'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { PageError } from './DashboardPage'

export function ActivityPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const overview = dashboard.overview.data

  if (dashboard.overview.isPending) {
    return <TransitionScreen message="Loading your wallet…" />
  }

  return (
    <ConsoleLayout config={config} email={overview?.user.email}>
      <PageHeading
        title="Activity"
        description="An audit trail of human and Agent actions that affected this wallet."
      />
      <PageError error={dashboard.overview.error} />
      {overview ? <Activity overview={overview} page /> : null}
    </ConsoleLayout>
  )
}
