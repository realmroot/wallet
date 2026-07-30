import type { PublicConfig } from '../auth'
import { Activity, DashboardSkeleton } from '../features/dashboard/DashboardComponents'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { PageError } from './DashboardPage'

export function ActivityPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const overview = dashboard.overview.data

  return (
    <ConsoleLayout config={config} email={overview?.user.email}>
      <PageHeading
        eyebrow="Security history"
        title="Activity"
        description="An audit trail of human and Agent actions that affected this wallet."
      />
      <PageError error={dashboard.overview.error} />
      {dashboard.overview.isPending ? <DashboardSkeleton /> : null}
      {overview ? <Activity overview={overview} page /> : null}
    </ConsoleLayout>
  )
}
