import type { PublicConfig } from '../../auth'
import { identityProfile, logout } from '../../auth'
import {
  appBasePath,
  networkPath,
  selectedNetwork,
  walletMode,
} from '../../environment'
import type { WalletMode } from '../../../shared/contracts'
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  Globe2,
  LayoutDashboard,
  LogOut,
  ReceiptText,
  WalletCards,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'wouter'

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, group: 'Wallet' },
  { href: '/accounts', label: 'Accounts', icon: WalletCards, group: 'Wallet' },
  { href: '/agents', label: 'Agents', icon: Bot, group: 'Wallet' },
  { href: '/payments', label: 'Payments', icon: ReceiptText, group: 'Operations' },
  { href: '/activity', label: 'Activity', icon: Activity, group: 'Operations' },
] as const

const navigationGroups = ['Wallet', 'Operations'] as const

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
  const visibleNetworks = config.networks.filter((candidate) => candidate.mode === walletMode)
  const identity = identityProfile()
  const identityEmail = identity?.email ?? email
  const identityName = identity?.name ?? identityEmail ?? 'Wallet account'
  const identityDetail = identity?.name && identityEmail ? identityEmail : 'Realmroot identity'
  const signOut = async () => {
    try {
      await logout(config)
    } finally {
      location.assign(`${config.appOrigin}${appBasePath}`)
    }
  }

  return (
    <div className="console-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="console-topbar">
        <div className="topbar-primary">
          <Link className="product-brand" href="/" aria-label="Agent Wallet home">
            <span className="brand-symbol"><WalletCards size={17} /></span>
            <strong>Agent Wallet</strong>
          </Link>
          <span className="topbar-divider" />
          <div className="wallet-context" aria-label="Current wallet context">
            <HoverMenu
              className="scope-menu environment-menu"
              label={`Wallet environment: ${environmentLabel(walletMode)}`}
              trigger={(
                <>
                  <span className={`environment-dot ${walletMode}`} />
                  <strong>{environmentLabel(walletMode)}</strong>
                  <ChevronDown size={13} />
                </>
              )}
              popoverClassName="scope-popover environment-popover"
            >
              <a
                role="menuitem"
                aria-current={walletMode === 'production' ? 'true' : undefined}
                href={`${config.appOrigin}${productModeReturnTo(network.alias, 'production', pathname)}`}
              >
                <span className="environment-option-dot production" />
                <span><strong>Production</strong><small>Live funds</small></span>
                {walletMode === 'production' ? <Check size={14} /> : null}
              </a>
              <a
                role="menuitem"
                aria-current={walletMode === 'sandbox' ? 'true' : undefined}
                href={`${config.appOrigin}${productModeReturnTo(network.alias, 'sandbox', pathname)}`}
              >
                <span className="environment-option-dot sandbox" />
                <span><strong>Sandbox</strong><small>Test funds</small></span>
                {walletMode === 'sandbox' ? <Check size={14} /> : null}
              </a>
            </HoverMenu>
            <span className="context-slash">/</span>
            <HoverMenu
              className="scope-menu network-menu"
              label={`Network view: ${network.name}`}
              trigger={(
                <>
                  <Globe2 size={14} />
                  <strong>{network.name}</strong>
                  <ChevronDown size={13} />
                </>
              )}
              popoverClassName="scope-popover network-popover"
            >
              {visibleNetworks.map((candidate) => (
                <a
                  aria-current={candidate.id === network.id ? 'true' : undefined}
                  href={`${config.appOrigin}${networkPath(config, candidate.id, pathname)}`}
                  key={candidate.id}
                  role="menuitem"
                >
                  <Globe2 size={15} />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>{networkFamilyLabel(candidate.family)}</small>
                  </span>
                  {candidate.id === network.id ? <Check size={14} /> : null}
                </a>
              ))}
            </HoverMenu>
          </div>
        </div>
        <div className="topbar-actions">
          <HoverMenu
            className="topbar-menu account-menu desktop-account-menu"
            label={`Open account menu for ${identityName}`}
            trigger={(
              <>
                <AccountAvatar email={identityEmail} picture={identity?.picture} />
                <span className="account-trigger-copy">
                  <strong>{identityName}</strong>
                  <small>{identityDetail}</small>
                </span>
                <ChevronDown size={13} />
              </>
            )}
            popoverClassName="topbar-popover account-popover"
          >
            <div className="account-identity">
              <AccountAvatar email={identityEmail} picture={identity?.picture} large />
              <span><strong>{identityName}</strong><small>{identityDetail}</small></span>
            </div>
            <button onClick={() => void signOut()} role="menuitem">
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          </HoverMenu>
        </div>
      </header>
      <aside className="sidebar">
        <nav className="sidebar-nav" aria-label="Wallet navigation">
          {navigationGroups.map((group) => (
            <div className="nav-group" key={group}>
              <p>{group}</p>
              {navigation.filter((item) => item.group === group).map((item) => {
                const active = pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    aria-current={active ? 'page' : undefined}
                    className={`nav-item${active ? ' active' : ''}`}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon size={16} />
                    <span>{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      <header className="mobile-header">
        <Link className="wordmark" href="/" aria-label="Agent Wallet home">
          <span className="brand-symbol"><WalletCards size={18} /></span>
          <span>Agent Wallet</span>
        </Link>
        <HoverMenu
          className="topbar-menu account-menu mobile-account-menu"
          label="Open wallet context and account menu"
          trigger={(
            <>
              <span className={`environment-dot ${walletMode}`} />
              <AccountAvatar email={identityEmail} picture={identity?.picture} />
              <ChevronDown size={14} />
            </>
          )}
          popoverClassName="topbar-popover account-popover"
        >
          <div className="mobile-context-section">
              <span className="sidebar-context-label">Environment</span>
              <div className="environment-switcher" aria-label="Wallet environment">
                <a role="menuitem" aria-current={walletMode === 'production' ? 'true' : undefined} aria-label="Live wallet" href={`${config.appOrigin}${productModeReturnTo(network.alias, 'production', pathname)}`}>Production</a>
                <a role="menuitem" aria-current={walletMode === 'sandbox' ? 'true' : undefined} aria-label="Test wallet" href={`${config.appOrigin}${productModeReturnTo(network.alias, 'sandbox', pathname)}`}>Sandbox</a>
              </div>
          </div>
          <div className="mobile-context-section">
              <span className="sidebar-context-label">Network</span>
              <div className="mobile-network-options" aria-label="Mobile network">
                {visibleNetworks.map((candidate) => (
                  <a
                    aria-current={candidate.id === network.id ? 'true' : undefined}
                    href={`${config.appOrigin}${networkPath(config, candidate.id, pathname)}`}
                    key={candidate.id}
                    role="menuitem"
                  >
                    <Globe2 size={15} />
                    <span>{candidate.name}</span>
                    {candidate.id === network.id ? <Check size={14} /> : null}
                  </a>
                ))}
              </div>
          </div>
          <div className="account-identity">
            <AccountAvatar email={identityEmail} picture={identity?.picture} large />
            <span><strong>{identityName}</strong><small>{identityDetail}</small></span>
          </div>
          <button onClick={() => void signOut()} role="menuitem"><LogOut size={16} /><span>Sign out</span></button>
        </HoverMenu>
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

function HoverMenu({
  children,
  className,
  label,
  popoverClassName,
  trigger,
}: {
  children: ReactNode
  className: string
  label: string
  popoverClassName: string
  trigger: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const menuId = useId()
  const mouseInside = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const openMenu = () => {
    cancelClose()
    setOpen(true)
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      if (!rootRef.current?.contains(document.activeElement)) setOpen(false)
    }, 120)
  }

  useEffect(() => {
    if (!open) return
    const closeFromOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeFromOutside)
    return () => document.removeEventListener('pointerdown', closeFromOutside)
  }, [open])

  useEffect(() => () => cancelClose(), [])

  return (
    <div
      className={`${className}${open ? ' open' : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        cancelClose()
        setOpen(false)
        triggerRef.current?.focus()
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        mouseInside.current = true
        openMenu()
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        mouseInside.current = false
        scheduleClose()
      }}
      ref={rootRef}
    >
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="menu-trigger"
        onClick={() => {
          cancelClose()
          setOpen((current) => mouseInside.current || !current)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          openMenu()
          window.requestAnimationFrame(() => {
            rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
          })
        }}
        ref={triggerRef}
        type="button"
      >
        {trigger}
      </button>
      {open ? (
        <div
          className={popoverClassName}
          id={menuId}
          onClick={(event) => {
            if ((event.target as HTMLElement).closest('[role="menuitem"]')) setOpen(false)
          }}
          role="menu"
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

function productModeReturnTo(
  alias: string,
  target: WalletMode,
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
  const modeBase = target === 'sandbox' ? '/sandbox' : ''
  return `${modeBase}${chain}${page === '/' ? '' : page}` || '/'
}

export function PageHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action}
    </div>
  )
}

function accountInitials(email?: string | null) {
  if (!email) return 'AW'
  return email.split('@')[0]?.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'AW'
}

function AccountAvatar({
  email,
  picture,
  large = false,
}: {
  email?: string | null
  picture?: string | null
  large?: boolean
}) {
  return (
    <span className={`account-avatar${large ? ' large' : ''}`}>
      {accountInitials(email)}
      {picture ? <img src={picture} alt="" referrerPolicy="no-referrer" /> : null}
    </span>
  )
}

function environmentLabel(environment: WalletMode) {
  return environment === 'sandbox' ? 'Sandbox' : 'Production'
}

function networkFamilyLabel(family: string) {
  return family === 'solana' ? 'Solana' : 'EVM'
}
