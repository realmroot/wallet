import { updateWallet } from './api'
import { accessToken, type PublicConfig } from './auth'
import { useAuthenticateWithJWT, useCreateDelegation, useCurrentUser, useEvmAccounts } from '@coinbase/cdp-hooks'
import { CDPReactProvider } from '@coinbase/cdp-react'
import type { ReactNode } from 'react'
import { useState } from 'react'

export function CdpProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  if (!config.cdpProjectId) return children
  return (
    <CDPReactProvider
      config={{
        projectId: config.cdpProjectId,
        ethereum: { createOnLogin: 'eoa' },
        customAuth: {
          getJwt: async () => accessToken() ?? undefined,
        },
      }}
    >
      {children}
    </CDPReactProvider>
  )
}

export function ProvisionWallet({
  config,
  onComplete,
  renewal = false,
}: {
  config: PublicConfig
  onComplete: () => Promise<void>
  renewal?: boolean
}) {
  if (!config.cdpProjectId) {
    return (
      <div className="empty-state">
        <p>CDP is not configured for this deployment. Add the CDP project and server credentials to provision wallets.</p>
      </div>
    )
  }
  return <CdpProvisioning config={config} onComplete={onComplete} renewal={renewal} />
}

function CdpProvisioning({
  config,
  onComplete,
  renewal,
}: {
  config: PublicConfig
  onComplete: () => Promise<void>
  renewal: boolean
}) {
  const { authenticateWithJWT } = useAuthenticateWithJWT()
  const { createDelegation } = useCreateDelegation()
  const { currentUser } = useCurrentUser()
  const { evmAccounts } = useEvmAccounts()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function provision() {
    setBusy(true)
    setError(null)
    try {
      const authenticated = currentUser ?? (await authenticateWithJWT()).user
      const address = evmAccounts?.[0]?.address ?? authenticated.evmAccountObjects?.[0]?.address
      if (!address) throw new Error('CDP did not provision an EVM account.')
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await createDelegation({ expiresAt })
      await updateWallet(config, {
        cdpUserId: authenticated.userId,
        address,
      })
      await onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Wallet provisioning failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="empty-state">
      <p>
        {renewal
          ? 'Renew this Wallet service’s delegated signing permission for another 30 days.'
          : 'Provision a CDP EVM wallet and grant this Wallet service a 30-day signing delegation.'}
      </p>
      <button className="primary" disabled={busy} onClick={provision}>
        {busy ? 'Working…' : renewal ? 'Renew delegation' : 'Create wallet'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  )
}
