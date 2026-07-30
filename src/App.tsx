import { hasToken, loadConfig } from './auth'
import { LoginPage } from './pages/LoginPage'
import { OidcCallbackPage } from './pages/OidcCallbackPage'
import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { Redirect, Route, Switch } from 'wouter'

const BudgetApprovalPage = lazy(() =>
  import('./pages/BudgetApprovalPage').then((module) => ({ default: module.BudgetApprovalPage })),
)
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
)

export function App() {
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
    <Suspense fallback={<main className="center">Loading…</main>}>
      <Switch>
        <Route path="/oidc/callback"><OidcCallbackPage config={config.data} /></Route>
        <Route path="/authorize"><BudgetApprovalPage config={config.data} /></Route>
        <Route path="/">
          {hasToken() ? <DashboardPage config={config.data} /> : <LoginPage config={config.data} />}
        </Route>
        <Route><Redirect replace to="/" /></Route>
      </Switch>
    </Suspense>
  )
}
