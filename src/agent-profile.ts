import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'

const agentProfileUriTemplateSchema = z.string().refine((value) => {
  const expanded = value.replace('{subject}', 'agt_subject')
  return (
    value.split('{subject}').length === 2 &&
    !expanded.includes('{') &&
    !expanded.includes('}') &&
    URL.canParse(expanded)
  )
}, 'Invalid Agent Profile URI template.')

const discoverySchema = z.object({
  issuer: z.url(),
  agent_profile_uri_template: agentProfileUriTemplateSchema,
})

const publicImageUrlSchema = z.union([z.url(), z.string().regex(/^\/api\/assets\/[A-Za-z0-9_-]+$/)])

const agentProfileSchema = z.object({
  type: z.literal('agent'),
  view: z.literal('summary'),
  issuer: z.url(),
  subject: z.string(),
  name: z.string(),
  picture: publicImageUrlSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type AgentProfile = z.infer<typeof agentProfileSchema>

export function useAgentProfile(issuer: string, subject: string) {
  return useQuery({
    queryKey: ['agent-profile', issuer, subject],
    queryFn: () => fetchAgentProfile(issuer, subject),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export async function fetchAgentProfile(issuer: string, subject: string): Promise<AgentProfile> {
  const metadataResponse = await fetch(authorizationServerMetadataUrl(issuer))
  if (!metadataResponse.ok) throw new Error('Agent profile discovery failed.')

  const metadata = discoverySchema.parse(await metadataResponse.json())
  if (metadata.issuer !== issuer) throw new Error('Agent profile discovery metadata is invalid.')

  const profileUrl = metadata.agent_profile_uri_template.replace('{subject}', encodeURIComponent(subject))
  const profileResponse = await fetch(profileUrl)
  if (!profileResponse.ok) throw new Error('Agent profile lookup failed.')

  const profile = agentProfileSchema.parse(await profileResponse.json())
  if (profile.issuer !== issuer || profile.subject !== subject) {
    throw new Error('Agent profile identity does not match.')
  }
  return { ...profile, picture: new URL(profile.picture, profileUrl).toString() }
}

function authorizationServerMetadataUrl(issuer: string) {
  const url = new URL(issuer)
  const issuerPath = url.pathname.replace(/\/$/, '')
  url.pathname = `/.well-known/oauth-authorization-server${issuerPath}`
  url.search = ''
  url.hash = ''
  return url
}
