import { fetchAgentInfo } from '../src/agent-info'
import { afterEach, describe, expect, it, vi } from 'vitest'

const issuer = 'https://id.realmroot.test/api/auth'
const subject = 'agt_stable'

afterEach(() => vi.restoreAllMocks())

describe('Realmroot AgentInfo', () => {
  it('discovers and resolves the stable Agent display identity', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          issuer,
          agentinfo_endpoint: `${issuer}/agentinfo`,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          iss: issuer,
          sub: subject,
          sub_profile: 'ai_agent',
          name: 'Build Agent',
          picture: 'https://id.realmroot.test/agent-picture-v1.svg',
          updated_at: 1_785_450_000,
        }),
      )

    await expect(fetchAgentInfo(issuer, subject)).resolves.toMatchObject({
      iss: issuer,
      sub: subject,
      name: 'Build Agent',
    })
    expect(String(fetch.mock.calls[1]?.[0])).toBe(`${issuer}/agentinfo?sub=agt_stable`)
  })

  it('rejects AgentInfo that does not match the requested identity', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({
          issuer,
          agentinfo_endpoint: `${issuer}/agentinfo`,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          iss: issuer,
          sub: 'agt_other',
          sub_profile: 'ai_agent',
          name: 'Other Agent',
          updated_at: 1_785_450_000,
        }),
      )

    await expect(fetchAgentInfo(issuer, subject)).rejects.toThrow(
      'Agent information identity does not match.',
    )
  })
})
