import type { PublicConfig } from '../auth'
import { completeLogin } from '../auth'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'
import { TransitionScreen } from '../components/TransitionScreen'

export function OidcCallbackPage({ config }: { config: PublicConfig }) {
  const [, navigate] = useLocation()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void completeLogin(config)
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'OIDC login failed.'))
  }, [config, navigate])

  if (error) return <main className="center"><div className="notice error">{error}</div></main>
  return <TransitionScreen message="Finishing the environment switch…" />
}
