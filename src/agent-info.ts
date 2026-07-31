import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

const discoverySchema = z.object({
  issuer: z.url(),
  agentinfo_endpoint: z.url(),
})

const agentInfoSchema = z.object({
  iss: z.url(),
  sub: z.string(),
  sub_profile: z.literal('ai_agent'),
  name: z.string(),
  picture: z.url().optional(),
  updated_at: z.number().int().nonnegative(),
})

export type AgentInfo = z.infer<typeof agentInfoSchema>

export function useAgentInfo(issuer: string, subject: string) {
  return useQuery({
    queryKey: ['agent-info', issuer, subject],
    queryFn: () => fetchAgentInfo(issuer, subject),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export async function fetchAgentInfo(issuer: string, subject: string): Promise<AgentInfo> {
  const metadataResponse = await fetch(`${issuer}/.well-known/openid-configuration`)
  if (!metadataResponse.ok) throw new Error('Agent issuer discovery failed.')

  const metadata = discoverySchema.parse(await metadataResponse.json())
  if (metadata.issuer !== issuer) throw new Error('Agent issuer discovery metadata is invalid.')

  const endpoint = new URL(metadata.agentinfo_endpoint)
  endpoint.searchParams.set('sub', subject)
  const infoResponse = await fetch(endpoint)
  if (!infoResponse.ok) throw new Error('Agent information lookup failed.')

  const info = agentInfoSchema.parse(await infoResponse.json())
  if (info.iss !== issuer || info.sub !== subject) {
    throw new Error('Agent information identity does not match.')
  }
  return info
}
