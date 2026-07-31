import type { PublicConfig } from '../../auth'
import { beginEnvironmentSwitch, logout } from '../../auth'
import {
  networkPath,
  selectedNetwork,
  type WalletEnvironment,
} from '../../environment'
import { TransitionScreen } from '../../components/TransitionScreen'
import {
  Activity,
  Bot,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  WalletCards,
} from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { Link, useLocation } from 'wouter'

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/agents', label: 'Agents', icon: Bot },
  { href: '/payments', label: 'Payments', icon: ReceiptText },
  { href: '/activity', label: 'Activity', icon: Activity },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const

export function ConsoleLayout({
  config,
  email,
  children,
}: {
  config: PublicConfig
  email?: string | null
  children: ReactNode
}) {
  const [pathname] = useLocation()
  const network = selectedNetwork(config)
  const [switchingTo, setSwitchingTo] = useState<WalletEnvironment | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const switchEnvironment = (
    event: MouseEvent<HTMLAnchorElement>,
    target: WalletEnvironment,
  ) => {
    if (target === config.environment) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    setSwitchError(null)
    setSwitchingTo(target)
    void beginEnvironmentSwitch(
      config,
      target,
      environmentReturnTo(network.alias, target, pathname),
    ).catch((cause: unknown) => {
      setSwitchingTo(null)
      setSwitchError(cause instanceof Error ? cause.message : 'Environment switch failed.')
    })
  }
  const signOut = async () => {
    try {
      await logout(config)
    } finally {
      location.assign(config.appBaseUrl)
    }
  }

  return (
    <div className="console-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <Link className="wordmark sidebar-wordmark" href="/" aria-label="Agent Wallet home">
          <span className="brand-symbol"><WalletCards size={18} /></span>
          <span>Agent Wallet</span>
        </Link>
        <div className="environment-switcher" aria-label="Wallet environment">
          <a
            aria-current={config.environment === 'production' ? 'true' : undefined}
            href={config.appOrigin}
            onClick={(event) => switchEnvironment(event, 'production')}
          >
            Production
          </a>
          <a
            aria-current={config.environment === 'sandbox' ? 'true' : undefined}
            href={`${config.appOrigin}/sandbox`}
            onClick={(event) => switchEnvironment(event, 'sandbox')}
          >
            Sandbox
          </a>
        </div>
        <div className="sidebar-network-context">
          <span className="sidebar-context-label">Network view</span>
          <label className="sidebar-network">
            <span aria-hidden="true" />
            <select
              aria-label="Network view"
              value={network.id}
              onChange={(event) => {
                location.assign(networkPath(config, event.target.value, pathname))
              }}
            >
              {config.networks.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
              ))}
            </select>
          </label>
        </div>
        <nav className="sidebar-nav" aria-label="Wallet navigation">
          {navigation.map((item) => {
            const active = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                aria-current={active ? 'page' : undefined}
                className={`nav-item${active ? ' active' : ''}`}
                href={item.href}
                key={item.href}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          {email ? <span title={email}>{email}</span> : <span>Wallet account</span>}
          <button className="nav-item signout-button" onClick={() => void signOut()}>
            <LogOut size={18} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="wordmark" href="/" aria-label="Agent Wallet home">
          <span className="brand-symbol"><WalletCards size={18} /></span>
          <span>Agent Wallet</span>
        </Link>
        <a
          className="mobile-environment"
          href={config.environment === 'sandbox' ? config.appOrigin : `${config.appOrigin}/sandbox`}
          onClick={(event) =>
            switchEnvironment(event, config.environment === 'sandbox' ? 'production' : 'sandbox')
          }
        >
          {config.environment === 'sandbox' ? 'Sandbox' : 'Production'}
        </a>
        <button className="icon-button" onClick={() => void signOut()} aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>

      <main className="console-main" id="main-content">{children}</main>

      <nav className="mobile-nav" aria-label="Wallet navigation">
        {navigation.map((item) => {
          const active = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={`mobile-nav-item${active ? ' active' : ''}`}
              href={item.href}
              key={item.href}
            >
              <Icon size={19} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
      {switchingTo ? (
        <TransitionScreen message="Loading your wallet…" overlay />
      ) : null}
      {switchError ? <div className="environment-switch-error" role="alert">{switchError}</div> : null}
    </div>
  )
}

function environmentReturnTo(
  alias: string,
  target: WalletEnvironment,
  page: string,
) {
  const targetAlias =
    target === 'sandbox'
      ? { base: null, world: 'world-sepolia', solana: 'solana-devnet' }[alias]
      : {
          'base-sepolia': null,
          'world-sepolia': 'world',
          'solana-devnet': 'solana',
        }[alias]
  const chain = targetAlias ? `/chains/${targetAlias}` : ''
  return `${chain}${page === '/' ? '' : page}` || '/'
}

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  )
}
