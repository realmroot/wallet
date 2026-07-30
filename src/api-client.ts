import type { HumanApiType } from '../server/app'
import { hc, type InferResponseType } from 'hono/client'

export const walletApi = hc<HumanApiType>('/api')

export type PublicConfig = InferResponseType<typeof walletApi.config.$get, 200>
