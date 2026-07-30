import type { AgentGrant } from '../../shared/contracts'
import { updateGrant } from '../api'
import type { PublicConfig } from '../auth'
import { AgentGrants, DashboardSkeleton } from '../features/dashboard/DashboardComponents'
import { ConsoleLayout, PageHeading } from '../features/dashboard/ConsoleLayout'
import { useWalletDashboard } from '../features/dashboard/use-wallet-dashboard'
import { GrantDialog } from '../features/grants/GrantDialog'
import { PageError } from './DashboardPage'
import { useState } from 'react'

export function AgentsPage({ config }: { config: PublicConfig }) {
  const dashboard = useWalletDashboard(config)
  const [editingGrant, setEditingGrant] = useState<AgentGrant | null>(null)
  const overview = dashboard.overview.data
  const error = dashboard.overview.error ?? dashboard.action.error

  return (
    <ConsoleLayout config={config} email={overview?.user.email}>
      <PageHeading
        eyebrow="Delegated access"
        title="Agents"
        description="Review every Agent’s budget, payment ceiling, merchant restrictions, and current state."
      />
      <PageError error={error} />
      {dashboard.overview.isPending ? <DashboardSkeleton /> : null}
      {overview ? (
        <AgentGrants
          grants={overview.grants}
          busy={dashboard.busy}
          run={dashboard.run}
          config={config}
          onEdit={setEditingGrant}
          page
        />
      ) : null}
      {editingGrant ? (
        <GrantDialog
          grant={editingGrant}
          busy={dashboard.busy(`edit-${editingGrant.id}`)}
          onClose={() => setEditingGrant(null)}
          onSave={async (input) => {
            await dashboard.run(`edit-${editingGrant.id}`, () => updateGrant(config, editingGrant.id, input))
            setEditingGrant(null)
          }}
        />
      ) : null}
    </ConsoleLayout>
  )
}
