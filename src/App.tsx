import { hasToken, loadConfig } from './auth'
import { CdpProvider } from './cdp'
import { LoginPage } from './pages/LoginPage'
import { OidcCallbackPage } from './pages/OidcCallbackPage'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Redirect, Route, Switch, useLocation } from 'wouter'

const BudgetApprovalPage = lazy(() =>
  import('./pages/BudgetApprovalPage').then((module) => ({ default: module.BudgetApprovalPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)
const AgentsPage = lazy(() =>
  import('./pages/AgentsPage').then((module) => ({ default: module.AgentsPage })),
)
const PaymentsPage = lazy(() =>
  import('./pages/PaymentsPage').then((module) => ({ default: module.PaymentsPage })),
)
const ActivityPage = lazy(() =>
  import('./pages/ActivityPage').then((module) => ({ default: module.ActivityPage })),
)
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })),
)

export function App() {
  const [pathname] = useLocation()
  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: loadConfig,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  if (config.isPending) return <main className="center">Loading…</main>
  if (config.error) {
    return <main className="center"><div className="notice error">{config.error.message}</div></main>
  }

  return (
    <CdpProvider config={config.data}>
      <Suspense fallback={<main className="center">Loading…</main>}>
        <Switch key={pathname}>
          <Route path="/oidc/callback"><OidcCallbackPage config={config.data} /></Route>
          <Route path="/authorize"><BudgetApprovalPage config={config.data} /></Route>
          <Route path="/">
            {hasToken() ? <DashboardPage config={config.data} /> : <LoginPage config={config.data} />}
          </Route>
          <Route path="/agents">
            {hasToken() ? <AgentsPage config={config.data} /> : <LoginPage config={config.data} returnTo="/agents" />}
          </Route>
          <Route path="/payments">
            {hasToken() ? <PaymentsPage config={config.data} /> : <LoginPage config={config.data} returnTo="/payments" />}
          </Route>
          <Route path="/activity">
            {hasToken() ? <ActivityPage config={config.data} /> : <LoginPage config={config.data} returnTo="/activity" />}
          </Route>
          <Route path="/settings">
            {hasToken() ? <SettingsPage config={config.data} /> : <LoginPage config={config.data} returnTo="/settings" />}
          </Route>
          <Route><Redirect replace to="/" /></Route>
        </Switch>
      </Suspense>
    </CdpProvider>
  )
}
