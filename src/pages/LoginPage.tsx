import type { PublicConfig } from '../auth'
import { beginLogin, hasRefreshToken } from '../auth'
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleCheck,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Route,
  ShieldCheck,
  Store,
  WalletCards,
} from 'lucide-react'
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
  const [loginPending, setLoginPending] = useState(continuingSession)

  useEffect(() => {
    if (!continuingSession) return
    void beginLogin(config, returnTo).catch((cause: unknown) => {
      setLoginPending(false)
      setLoginError(cause instanceof Error ? cause.message : 'OIDC login failed.')
    })
  }, [config, continuingSession, returnTo])

  const openWallet = () => {
    setLoginPending(true)
    setLoginError(null)
    void beginLogin(config, returnTo).catch((cause: unknown) => {
      setLoginPending(false)
      setLoginError(cause instanceof Error ? cause.message : 'OIDC login failed.')
    })
  }

  return (
    <main className="login-page">
      <section className="login-hero">
        <div className="login-header">
          <a className="wordmark login-wordmark" href={`${config.appOrigin}${appBasePath}`} aria-label="Agent Wallet home">
            <span className="brand-symbol"><WalletCards aria-hidden="true" size={18} /></span>
            <span translate="no">Agent Wallet</span>
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
          <span className="product-kicker">
            <span /> Agent payments <strong translate="no">x402 ready</strong>
          </span>
          <h1><span>Set the budget.</span><em>Keep the keys.</em></h1>
          <p>
            Give every Agent an explicit, revocable payment policy across EVM and Solana—without exposing your wallet credentials.
          </p>
          <button
            className="primary-button login-cta"
            disabled={loginPending}
            onClick={openWallet}
          >
            {loginPending ? <LoaderCircle aria-hidden="true" className="button-spinner" size={17} /> : null}
            {loginPending ? 'Opening Your Wallet…' : 'Open Your Agent Wallet'}
            {!loginPending ? <ArrowRight aria-hidden="true" size={17} /> : null}
          </button>
          <span className="cta-assurance"><CheckCircle2 aria-hidden="true" size={14} /> Your identity remains the approval boundary</span>
          {error || loginError ? <p className="login-error" role="alert">{error ?? loginError}</p> : null}
        </div>
        <div className="trust-row" aria-label="Product capabilities">
          <span><ShieldCheck aria-hidden="true" size={16} /> Non-custodial</span>
          <span><KeyRound aria-hidden="true" size={16} /> Revocable access</span>
          <span><Route aria-hidden="true" size={16} /> EVM + Solana</span>
        </div>
      </section>
      <section className="login-preview" aria-label="Agent Wallet preview">
        <div aria-hidden="true" className="preview-glow" />
        <div className="preview-stage">
          <div className="preview-heading">
            <span>Explicit authority</span>
            <h2>Every payment stays inside your policy.</h2>
          </div>
          <div className="preview-window authority-window">
            <header className="authority-header">
              <div className="authority-wallet-mark"><WalletCards aria-hidden="true" size={18} /></div>
              <div>
                <strong>Your wallet</strong>
                <span>Non-custodial control plane</span>
              </div>
              <span className="protected-status"><ShieldCheck aria-hidden="true" size={13} /> Protected</span>
            </header>

            <div className="preview-balance">
              <div>
                <small>Available balance</small>
                <strong>2,480.00 <span>USDC</span></strong>
              </div>
              <span className="preview-network"><span /> {networkName(config.defaultNetwork)}</span>
            </div>

            <div className="authority-flow" role="img" aria-label="Your wallet delegates a limited budget to Research Agent">
              <div className="flow-node">
                <span><ShieldCheck aria-hidden="true" size={16} /></span>
                <div><small>Authority</small><strong>Owner controlled</strong></div>
              </div>
              <div aria-hidden="true" className="flow-connector"><span /><ArrowRight size={14} /></div>
              <div className="flow-node">
                <span><Bot aria-hidden="true" size={16} /></span>
                <div><small>Delegate</small><strong>Research Agent</strong></div>
              </div>
            </div>

            <div className="policy-card">
              <div className="policy-heading">
                <div><small>Active policy</small><strong>Research budget</strong></div>
                <span className="status"><span /> Active</span>
              </div>
              <dl className="policy-metrics">
                <div><dt>Total budget</dt><dd>$100.00</dd></div>
                <div><dt>Per payment</dt><dd>$10.00</dd></div>
                <div><dt>Used</dt><dd>$23.40</dd></div>
              </dl>
              <div className="policy-progress-label"><span>23.4% used</span><span>$76.60 available</span></div>
              <div className="budget-progress preview-progress" role="img" aria-label="23.4% of the Research budget is used"><span /></div>
              <div className="allowed-merchant">
                <span className="merchant-icon"><Store aria-hidden="true" size={15} /></span>
                <div><small>Allowed merchant</small><strong translate="no">api.weather.dev</strong></div>
                <CircleCheck aria-hidden="true" size={17} />
              </div>
            </div>

            <footer className="authority-footer">
              <LockKeyhole aria-hidden="true" size={14} /> Policy changes always require your approval
            </footer>
          </div>
        </div>
      </section>
    </main>
  )
}
