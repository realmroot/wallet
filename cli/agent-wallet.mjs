#!/usr/bin/env node

import { calculateJwkThumbprint, exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'wallet-url': { type: 'string', default: process.env.AGENT_WALLET_URL ?? 'http://localhost:5174' },
    'agent-token': { type: 'string', default: process.env.FA_AGENT_TOKEN },
    'agent-name': { type: 'string', default: process.env.AGENT_WALLET_AGENT_NAME },
    'dpop-key': {
      type: 'string',
      default: process.env.FA_DPOP_KEY ?? `${process.env.HOME}/.config/agent-wallet/dpop.jwk`,
    },
    header: { type: 'string', multiple: true, default: [] },
    'no-open': { type: 'boolean', default: false },
  },
})

const [command, ...args] = positionals
if (command === 'dpop' && args[0] === 'init') {
  const key = await loadOrCreateDpopKey(values['dpop-key'])
  const publicJwk = publicKey(key)
  process.stdout.write(
    `${JSON.stringify({
      path: values['dpop-key'],
      thumbprint: await calculateJwkThumbprint(publicJwk),
      publicJwk,
    }, null, 2)}\n`,
  )
  process.exit(0)
}

if (command !== 'authorize' && command !== 'x402') usage()
if (!values['agent-token']) fail('An FA Agent access token is required via --agent-token or FA_AGENT_TOKEN.')
const dpopKey = await loadOrCreateDpopKey(values['dpop-key'])

if (command === 'authorize') {
  await ensureBudget()
  process.stdout.write('Agent budget is active.\n')
  process.exit(0)
}

const [method = 'GET', resourceUrl] = args
if (!resourceUrl) usage()
const requestHeaders = new Headers()
for (const value of values.header) {
  const index = value.indexOf(':')
  if (index < 1) fail(`Invalid --header value: ${value}`)
  requestHeaders.append(value.slice(0, index).trim(), value.slice(index + 1).trim())
}

const initial = await fetch(resourceUrl, { method, headers: requestHeaders })
if (initial.status !== 402) {
  await printResponse(initial)
  process.exit(initial.ok ? 0 : 1)
}

const paymentRequired = await decodePaymentRequired(initial)
await ensureBudget()
const walletEndpoint = new URL('/api/x402/payments', values['wallet-url']).toString()
const payment = await agentFetch(walletEndpoint, {
  method: 'POST',
  body: JSON.stringify(paymentRequired),
})
if (!payment.ok) fail(`Wallet rejected the payment (${payment.status}): ${await payment.text()}`)

const { paymentPayload } = await payment.json()
const paidHeaders = new Headers(requestHeaders)
paidHeaders.set('payment-signature', encodeHeader(paymentPayload))
const paid = await fetch(resourceUrl, { method, headers: paidHeaders })
await printResponse(paid)
process.exit(paid.ok ? 0 : 1)

async function ensureBudget() {
  const endpoint = new URL('/api/agent/budget-requests', values['wallet-url']).toString()
  const response = await agentFetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(values['agent-name'] ? { name: values['agent-name'] } : {}),
  })
  if (!response.ok) fail(`Wallet could not start budget authorization (${response.status}): ${await response.text()}`)
  const request = await response.json()
  if (request.status === 'approved') return request
  if (request.status !== 'pending' || !request.approvalUrl) fail('Wallet returned an invalid budget authorization response.')

  process.stderr.write(`Approve this Agent budget in your browser:\n${request.approvalUrl}\n`)
  if (!values['no-open']) openBrowser(request.approvalUrl)
  const statusEndpoint = new URL(
    `/api/agent/budget-requests/${encodeURIComponent(request.id)}`,
    values['wallet-url'],
  ).toString()
  const interval = Math.max(1, Number(request.interval) || 3)
  while (Date.now() < new Date(request.expiresAt).getTime()) {
    await delay(interval * 1000)
    const statusResponse = await agentFetch(statusEndpoint, { method: 'GET' })
    if (!statusResponse.ok) {
      fail(`Wallet could not read budget authorization (${statusResponse.status}): ${await statusResponse.text()}`)
    }
    const status = await statusResponse.json()
    if (status.status === 'approved') return status
    if (status.status === 'denied') fail('The Agent budget request was denied.')
    if (status.status === 'expired') fail('The Agent budget request expired.')
  }
  fail('The Agent budget request expired.')
}

async function agentFetch(url, init) {
  const method = init.method ?? 'GET'
  return fetch(url, {
    ...init,
    headers: {
      authorization: `DPoP ${values['agent-token']}`,
      dpop: await createDpopProof(dpopKey, values['agent-token'], method, url),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
}

async function decodePaymentRequired(response) {
  const encoded = response.headers.get('payment-required')
  if (encoded) return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const body = await response.json()
  if (body?.x402Version && body?.accepts) return body
  if (body?.paymentRequired) return body.paymentRequired
  fail('The 402 response did not contain an x402 PaymentRequired payload.')
}

async function loadOrCreateDpopKey(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    const pair = await generateKeyPair('ES256', { extractable: true })
    const key = await exportJWK(pair.privateKey)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    await writeFile(path, `${JSON.stringify(key)}\n`, { mode: 0o600, flag: 'wx' })
    return key
  }
}

async function createDpopProof(privateJwk, accessToken, method, url) {
  const privateKey = await importJWK(privateJwk, 'ES256')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken))
  const ath = Buffer.from(digest).toString('base64url')
  return new SignJWT({ htm: method, htu: url, ath })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: publicKey(privateJwk) })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .sign(privateKey)
}

function publicKey(privateJwk) {
  const value = { ...privateJwk }
  delete value.d
  return value
}

function openBrowser(url) {
  const command =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function encodeHeader(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

async function printResponse(response) {
  process.stdout.write(`${response.status} ${response.statusText}\n`)
  process.stdout.write(`${await response.text()}\n`)
}

function usage() {
  fail(
    'Usage:\n' +
      '  agent-wallet dpop init [--dpop-key PATH]\n' +
      '  agent-wallet authorize --agent-token TOKEN [--wallet-url URL]\n' +
      '  agent-wallet x402 [METHOD] URL --agent-token TOKEN [--wallet-url URL] [--header "Name: value"]',
  )
}

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}
