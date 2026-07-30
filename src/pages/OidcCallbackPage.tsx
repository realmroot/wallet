import type { PublicConfig } from '../auth'
import { completeLogin } from '../auth'
import { useEffect, useState } from 'react'
import { useLocation } from 'wouter'

export function OidcCallbackPage({ config }: { config: PublicConfig }) {
  const [, navigate] = useLocation()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void completeLogin(config)
      .then((returnTo) => navigate(returnTo, { replace: true }))
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'OIDC login failed.'))
  }, [config, navigate])

  return <main className="center">{error ? <div className="notice error">{error}</div> : 'Signing in…'}</main>
}
