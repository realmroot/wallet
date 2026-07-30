import type { HumanApiType } from '../server/app'
import { apiBasePath } from './environment'
import { hc, type InferResponseType } from 'hono/client'

export const walletApi = hc<HumanApiType>(apiBasePath)

export type PublicConfig = InferResponseType<typeof walletApi.config.$get, 200>
