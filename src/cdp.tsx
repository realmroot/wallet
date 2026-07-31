import { updateWallet } from './api'
import { cdpAccessToken, type PublicConfig } from './auth'
import {
  useAuthenticateWithJWT,
  useCreateDelegation,
  useCreateEvmEoaAccount,
  useCreateSolanaAccount,
  useCurrentUser,
  useEvmAccounts,
  useSolanaAccounts,
} from '@coinbase/cdp-hooks'
import { CDPReactProvider } from '@coinbase/cdp-react'
import * as Dialog from '@radix-ui/react-dialog'
import type { User } from '@coinbase/cdp-core'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

type AccountFamily = 'evm' | 'solana'

export function CdpProvider({ config, children }: { config: PublicConfig; children: ReactNode }) {
  if (!config.cdpProjectId) return children
  return (
    <CDPReactProvider
      config={{
        projectId: config.cdpProjectId,
        customAuth: { getJwt: () => cdpAccessToken(config) },
      }}
    >
      {children}
    </CDPReactProvider>
  )
}

export function ProvisionWallet({
  config,
  family,
  onComplete,
  renewal = false,
}: {
  config: PublicConfig
  family: AccountFamily
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
  return (
    <CdpProvisioning
      config={config}
      family={family}
      onComplete={onComplete}
      renewal={renewal}
    />
  )
}

function CdpProvisioning({
  config,
  family,
  onComplete,
  renewal,
}: {
  config: PublicConfig
  family: AccountFamily
  onComplete: () => Promise<void>
  renewal: boolean
}) {
  const { authenticateWithJWT } = useAuthenticateWithJWT()
  const { createDelegation } = useCreateDelegation()
  const { createEvmEoaAccount } = useCreateEvmEoaAccount()
  const { createSolanaAccount } = useCreateSolanaAccount()
  const { currentUser } = useCurrentUser()
  const { evmAccounts } = useEvmAccounts()
  const { solanaAccounts } = useSolanaAccounts()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [awaitingCurrentUser, setAwaitingCurrentUser] = useState(false)
  const completionStarted = useRef(false)

  useEffect(() => {
    if (!awaitingCurrentUser || !currentUser || completionStarted.current) return
    completionStarted.current = true
    setAwaitingCurrentUser(false)
    void completeProvision(currentUser)
  }, [awaitingCurrentUser, currentUser])

  async function provision() {
    setBusy(true)
    setError(null)
    completionStarted.current = false
    try {
      if (!currentUser) {
        await authenticateWithJWT()
        setAwaitingCurrentUser(true)
        return
      }
      completionStarted.current = true
      await completeProvision(currentUser)
    } catch (cause) {
      failProvision(cause)
    }
  }

  async function completeProvision(authenticated: User) {
    try {
      let evmAddress =
        evmAccounts?.[0]?.address ?? authenticated.evmAccountObjects?.[0]?.address ?? null
      let solanaAddress =
        solanaAccounts?.[0]?.address ?? authenticated.solanaAccountObjects?.[0]?.address ?? null
      const wantsEvm = renewal ? Boolean(evmAddress) : family === 'evm'
      const wantsSolana = renewal ? Boolean(solanaAddress) : family === 'solana'
      if (wantsEvm && !evmAddress) evmAddress = await createEvmEoaAccount()
      if (wantsSolana && !solanaAddress) solanaAddress = await createSolanaAccount()
      const accounts = [
        ...(wantsEvm && evmAddress ? [{ family: 'evm' as const, address: evmAddress }] : []),
        ...(wantsSolana && solanaAddress ? [{ family: 'solana' as const, address: solanaAddress }] : []),
      ]
      if (accounts.length === 0) throw new Error('CDP did not provide the selected wallet account.')

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      try {
        await createDelegation({ expiresAt })
      } catch (cause) {
        if (!activeDelegationExists(cause)) throw cause
      }
      await updateWallet(config, { cdpUserId: authenticated.userId, accounts })
      await onComplete()
      setOpen(false)
    } catch (cause) {
      failProvision(cause)
    } finally {
      setBusy(false)
    }
  }

  function failProvision(cause: unknown) {
    setError(cause instanceof Error ? cause.message : 'Wallet provisioning failed.')
    setBusy(false)
  }

  const familyLabel = family === 'evm' ? 'EVM' : 'Solana'
  const networkNames = config.networks
    .filter((network) => network.family === family)
    .map((network) => network.name)
  const provisioningDescription =
    family === 'evm'
      ? `Create one EVM account shared by ${formatList(networkNames)}. Balances and activity remain separate on each network.`
      : `Create one Solana account for ${formatList(networkNames)}. It remains separate from your EVM account.`

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <Dialog.Trigger asChild>
        <button className="primary-button">
          {renewal ? 'Renew delegation' : `Set up ${familyLabel} wallet`}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className="dialog account-dialog">
          <Dialog.Title>
            {renewal ? 'Renew signing delegation' : `Set up ${familyLabel} wallet`}
          </Dialog.Title>
          <Dialog.Description>
            {renewal
              ? 'Renew delegated signing for every registered account for another 30 days.'
              : provisioningDescription}
          </Dialog.Description>
          {error ? <p className="error">{error}</p> : null}
          <div className="dialog-actions">
            <Dialog.Close asChild><button className="quiet-button" disabled={busy}>Cancel</button></Dialog.Close>
            <button className="primary-button" disabled={busy} onClick={provision}>
              {busy ? 'Working…' : renewal ? 'Renew delegation' : `Create ${familyLabel} account`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? 'this network'
  if (values.length === 2) return values.join(' and ')
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`
}

function activeDelegationExists(cause: unknown) {
  return cause instanceof Error &&
    cause.message.includes('An active delegation already exists for this user.')
}
