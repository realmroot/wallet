import { getOverview, requestFaucet } from '../../api'
import type { PublicConfig } from '../../auth'
import type { FaucetRequest, WalletOverview } from '../../../shared/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { selectedNetwork } from '../../environment'

export function useWalletDashboard(config: PublicConfig) {
  const overviewKey = ['wallet-overview', selectedNetwork(config).id] as const
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: overviewKey,
    queryFn: () => getOverview(config),
  })
  const action = useMutation({
    mutationFn: ({ run }: { key: string; run: () => Promise<unknown> }) => run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: overviewKey })
    },
  })

  return {
    overview,
    action,
    busy: (key: string) => action.isPending && action.variables?.key === key,
    run: (key: string, operation: () => Promise<unknown>) => action.mutateAsync({ key, run: operation }),
    fund: (asset: FaucetRequest['asset']) => {
      const initialAmount = faucetBalance(overview.data, asset)
      return action.mutateAsync({
        key: `faucet-${asset}`,
        run: async () => {
          const result = await requestFaucet(config, {
            network: selectedNetwork(config).id,
            asset,
          })
          for (let attempt = 0; attempt < 20; attempt += 1) {
            if (attempt > 0) await delay(1_500)
            const refreshed = await overview.refetch()
            if (refreshed.error) throw refreshed.error
            if (faucetBalance(refreshed.data, asset) !== initialAmount) return result
          }
          return result
        },
      })
    },
    reload: async () => {
      await queryClient.invalidateQueries({ queryKey: overviewKey })
    },
  }
}

function faucetBalance(overview: WalletOverview | undefined, asset: FaucetRequest['asset']) {
  return overview?.runtime.balances.find((balance) =>
    asset === 'native' ? balance.assetAddress === null : balance.symbol === 'USDC',
  )?.amount
}

function delay(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}
