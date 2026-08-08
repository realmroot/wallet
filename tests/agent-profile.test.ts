import { fetchAgentProfile } from '../src/agent-profile'
import { afterEach, describe, expect, it, vi } from 'vitest'

const issuer = 'https://id.realmroot.test/api/auth'
const subject = 'agt_stable/child'

afterEach(() => vi.restoreAllMocks())

describe('Realmroot public Agent Profile', () => {
  it('discovers and resolves the stable Agent display identity', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          issuer,
          agent_profile_uri_template: 'https://id.realmroot.test/api/public/agents/{subject}',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          type: 'agent',
          view: 'summary',
          issuer,
          subject,
          name: 'Build Agent',
          picture: '/api/assets/agent-avatar',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        }),
      )

    await expect(fetchAgentProfile(issuer, subject)).resolves.toMatchObject({
      issuer,
      subject,
      name: 'Build Agent',
      picture: 'https://id.realmroot.test/api/assets/agent-avatar',
    })
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://id.realmroot.test/.well-known/oauth-authorization-server/api/auth',
    )
    expect(String(fetch.mock.calls[1]?.[0])).toBe(
      'https://id.realmroot.test/api/public/agents/agt_stable%2Fchild',
    )
  })

  it('rejects a public Agent Profile that does not match the requested identity', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          issuer,
          agent_profile_uri_template: 'https://id.realmroot.test/api/public/agents/{subject}',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          type: 'agent',
          view: 'summary',
          issuer,
          subject: 'agt_other',
          name: 'Other Agent',
          picture: 'https://id.realmroot.test/agent-picture-v1.svg',
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-02T00:00:00.000Z',
        }),
      )

    await expect(fetchAgentProfile(issuer, subject)).rejects.toThrow(
      'Agent profile identity does not match.',
    )
  })

  it('rejects discovery metadata without one absolute subject URI template', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        issuer,
        agent_profile_uri_template: '/api/public/agents/{subject}/{view}',
      }),
    )

    await expect(fetchAgentProfile(issuer, subject)).rejects.toThrow(
      'Invalid Agent Profile URI template.',
    )
  })
})
