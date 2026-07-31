import { getOverview } from '../../api'
import type { PublicConfig } from '../../auth'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { selectedNetwork } from '../../environment'

export function useWalletDashboard(config: PublicConfig) {
  const overviewKey = ['wallet-overview', config.environment, selectedNetwork(config).id] as const
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
    reload: async () => {
      await queryClient.invalidateQueries({ queryKey: overviewKey })
    },
  }
}
