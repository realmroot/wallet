import { badRequest, upstreamError } from './errors'
import { walletNetworkDefinition, walletNetworkRpcUrl } from './network'

export async function validatePaymentRecipient(env: Env, network: string, payTo: string) {
  const definition = walletNetworkDefinition(network)
  if (definition.family !== 'solana') return

  let account: unknown | null
  try {
    const response = await fetch(walletNetworkRpcUrl(env, network), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'getAccountInfo',
        params: [payTo, { encoding: 'base64', commitment: 'confirmed' }],
      }),
    })
    if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`)
    const body = await response.json<{
      result?: { value: unknown | null }
      error?: { message?: string }
    }>()
    if (body.error || !body.result) {
      throw new Error(body.error?.message ?? 'Solana RPC returned an invalid response.')
    }
    account = body.result.value
  } catch {
    throw upstreamError(`Could not verify the ${definition.name} payment recipient.`)
  }
  if (account === null) {
    throw badRequest(
      `The Solana payment recipient is not initialized on ${definition.name}. Use an address that already exists on-chain.`,
    )
  }
}
