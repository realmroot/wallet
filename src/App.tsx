import { hasToken, loadConfig } from './auth'
import { CdpProvider } from './cdp'
import { LoginPage } from './pages/LoginPage'
import { OidcCallbackPage } from './pages/OidcCallbackPage'
import { DashboardPage } from './pages/DashboardPage'
import { AgentsPage } from './pages/AgentsPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { ActivityPage } from './pages/ActivityPage'
import { AccountsPage } from './pages/AccountsPage'
import { TransitionScreen } from './components/TransitionScreen'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Redirect, Route, Switch } from 'wouter'

const BudgetApprovalPage = lazy(() =>
  import('./pages/BudgetApprovalPage').then((module) => ({ default: module.BudgetApprovalPage })),
)

export function App() {
  const config = useQuery({
    queryKey: ['public-config'],
    queryFn: loadConfig,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  if (config.isPending) return <TransitionScreen message="Loading your wallet…" />
  if (config.error) {
    return <main className="center"><div className="notice error">{config.error.message}</div></main>
  }

  return (
    <CdpProvider config={config.data}>
      <Switch>
        <Route path="/oidc/callback"><OidcCallbackPage config={config.data} /></Route>
        <Route path="/authorize">
          <Suspense fallback={<TransitionScreen message="Loading approval…" />}>
            <BudgetApprovalPage config={config.data} />
          </Suspense>
        </Route>
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
        <Route path="/accounts">
          {hasToken() ? <AccountsPage config={config.data} /> : <LoginPage config={config.data} returnTo="/accounts" />}
        </Route>
        <Route><Redirect replace to="/" /></Route>
      </Switch>
    </CdpProvider>
  )
}
