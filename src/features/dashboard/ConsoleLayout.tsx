import type { PublicConfig } from '../../auth'
import { logout } from '../../auth'
import {
  Activity,
  Bot,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  Settings,
  WalletCards,
} from 'lucide-react'
import type { ReactNode } from 'react'
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
  const signOut = async () => {
    try {
      await logout(config)
    } finally {
      location.assign('/')
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
        <div className="sidebar-network"><span /> Base Sepolia</div>
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
    </div>
  )
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
