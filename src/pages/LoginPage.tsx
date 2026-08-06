import type { PublicConfig } from '../auth'
import { beginLogin, hasRefreshToken } from '../auth'
import { ArrowRight, Bot, KeyRound, ShieldCheck, WalletCards } from 'lucide-react'
import { appBasePath, networkName, walletMode } from '../environment'
import { useEffect, useState } from 'react'

export function LoginPage({
  config,
  error,
  returnTo = '/',
}: {
  config: PublicConfig
  error?: string | null
  returnTo?: string
}) {
  const [loginError, setLoginError] = useState<string | null>(null)
  const continuingSession = hasRefreshToken()

  useEffect(() => {
    if (!continuingSession) return
    void beginLogin(config, returnTo).catch((cause: unknown) => {
      setLoginError(cause instanceof Error ? cause.message : 'OIDC login failed.')
    })
  }, [config, continuingSession, returnTo])

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-header">
          <a className="wordmark login-wordmark" href={`${config.appOrigin}${appBasePath}`} aria-label="Agent Wallet home">
            <span className="brand-symbol"><WalletCards size={18} /></span>
            <span>Agent Wallet</span>
          </a>
          <div className="environment-switcher login-environment-switcher" aria-label="Wallet mode">
            <a
              aria-current={walletMode === 'production' ? 'true' : undefined}
              href={config.appOrigin}
            >
              Production
            </a>
            <a
              aria-current={walletMode === 'sandbox' ? 'true' : undefined}
              href={`${config.appOrigin}/sandbox`}
            >
              Sandbox
            </a>
          </div>
        </div>
        <div className="login-copy">
          <span className="product-kicker"><span /> OIDC-native Agent payments</span>
          <h1>Give Agents a budget.<br /><em>Keep the keys.</em></h1>
          <p>
            One secure wallet for your account. Explicit, revocable spending boundaries for every Agent.
            Standard x402 payments across EVM and Solana networks.
          </p>
          <button
            className="primary-button login-cta"
            onClick={() => void beginLogin(config, returnTo).catch((cause: unknown) => {
              setLoginError(cause instanceof Error ? cause.message : 'OIDC login failed.')
            })}
          >
            {continuingSession ? 'Restoring session…' : 'Continue with identity provider'}
            <ArrowRight size={17} />
          </button>
          {error || loginError ? <p className="login-error" role="alert">{error ?? loginError}</p> : null}
        </div>
        <div className="trust-row" aria-label="Product capabilities">
          <span><ShieldCheck size={16} /> Non-custodial controls</span>
          <span><KeyRound size={16} /> Delegated signing</span>
          <span><Bot size={16} /> Per-Agent limits</span>
        </div>
      </section>
      <section className="login-preview" aria-label="Agent Wallet preview">
        <div className="preview-glow" />
        <div className="preview-window">
          <div className="preview-bar">
            <span /><span /><span />
            <small>wallet.agent</small>
          </div>
          <div className="preview-balance">
            <small>Available balance</small>
            <strong>2,480.00 <span>USDC</span></strong>
            <div className="preview-wallet-line">
              <span /> {networkName(config.defaultNetwork)} · Protected
            </div>
          </div>
          <div className="preview-agent">
            <span className="agent-avatar"><Bot size={18} /></span>
            <div><strong>Research Agent</strong><small>Active spending policy</small></div>
            <span className="status"><span /> Active</span>
          </div>
          <div className="preview-limit">
            <div><span>Spent</span><strong>$23.40</strong></div>
            <div><span>Budget</span><strong>$100.00</strong></div>
          </div>
          <div className="budget-progress preview-progress"><span /></div>
          <div className="preview-payment">
            <span className="merchant-icon"><ArrowRight size={16} /></span>
            <div><strong>api.weather.dev</strong><small>Settled just now</small></div>
            <strong>$0.025</strong>
          </div>
        </div>
      </section>
    </main>
  )
}
