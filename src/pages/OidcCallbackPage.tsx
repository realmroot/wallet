import type { PublicConfig } from '../auth'
import { completeLogin } from '../auth'
import { useEffect, useState } from 'react'
import { TransitionScreen } from '../components/TransitionScreen'

export function OidcCallbackPage({ config }: { config: PublicConfig }) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void completeLogin(config)
      .then((returnTo) => location.replace(returnTo))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'OIDC login failed.'))
  }, [config])

  if (error) return <main className="center"><div className="notice error">{error}</div></main>
  return <TransitionScreen message="Finishing sign in…" />
}
