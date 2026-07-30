import type { BudgetDecisionInput, BudgetRequestDetail, WalletOverview } from '../shared/contracts'
import { accessToken, refreshAccessToken } from './auth'
import { type PublicConfig, walletApi } from './api-client'
import type { InferRequestType } from 'hono/client'

type UpdateWalletInput = InferRequestType<typeof walletApi.wallet.$put>['json']
interface ApiResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

export async function getOverview(config: PublicConfig): Promise<WalletOverview> {
  return json(await authenticated(config, (headers) => walletApi.overview.$get({}, { headers })))
}

export async function updateWallet(config: PublicConfig, input: UpdateWalletInput): Promise<void> {
  await empty(await authenticated(config, (headers) => walletApi.wallet.$put({ json: input }, { headers })))
}

export async function inspectBudgetRequest(
  config: PublicConfig,
  id: string,
  approvalToken: string,
): Promise<BudgetRequestDetail> {
  return json(
    await authenticated(config, (headers) =>
      walletApi['budget-requests'][':id'].inspect.$post(
        { param: { id }, json: { approvalToken } },
        { headers },
      ),
    ),
  )
}

export async function decideBudgetRequest(
  config: PublicConfig,
  id: string,
  input: BudgetDecisionInput,
) {
  return json(
    await authenticated(config, (headers) =>
      walletApi['budget-requests'][':id'].decision.$put({ param: { id }, json: input }, { headers }),
    ),
  )
}

export async function revokeGrant(config: PublicConfig, id: string): Promise<void> {
  await empty(
    await authenticated(config, (headers) =>
      walletApi.grants[':id'].$delete({ param: { id } }, { headers }),
    ),
  )
}

async function authenticated(
  config: PublicConfig,
  call: (headers: { authorization: string }) => Promise<ApiResponse>,
) {
  const request = () => {
    const token = accessToken()
    if (!token) throw new Error('OIDC login expired.')
    return call({ authorization: `Bearer ${token}` })
  }

  let response = await request()
  if (response.status === 401 && localStorage.getItem('agent-wallet.refresh_token')) {
    await refreshAccessToken(config)
    response = await request()
  }
  return response
}

async function json<T>(response: ApiResponse): Promise<T> {
  if (!response.ok) throw await responseError(response)
  return (await response.json()) as T
}

async function empty(response: ApiResponse): Promise<void> {
  if (!response.ok) throw await responseError(response)
}

async function responseError(response: ApiResponse) {
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  return new Error(body?.message ?? `Request failed with ${response.status}.`)
}
