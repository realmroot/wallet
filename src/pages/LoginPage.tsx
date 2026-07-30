import type { PublicConfig } from '../auth'
import { beginLogin } from '../auth'

export function LoginPage({
  config,
  error,
  returnTo = '/',
}: {
  config: PublicConfig
  error?: string | null
  returnTo?: string
}) {
  return (
    <main className="login">
      <div className="brand-mark">AW</div>
      <p className="eyebrow">OIDC-native payments</p>
      <h1>A wallet agents can use, under your rules.</h1>
      <p className="lede">One wallet per user. Explicit budgets per Agent. Standard x402 payments on Base.</p>
      <button className="primary" onClick={() => beginLogin(config, returnTo)}>
        Continue with your identity provider
      </button>
      {error ? <p className="error">{error}</p> : null}
    </main>
  )
}
