import type {
  AgentGrant,
  BudgetDecisionInput,
  BudgetRequestDetail,
  BudgetRequestState,
  WalletOverview,
  WalletUser,
} from '../shared/contracts'
import type { AgentPrincipal, HumanPrincipal } from './auth'
import { conflict, forbidden, notFound } from './errors'

interface UserRow {
  id: string
  issuer: string
  subject: string
  email: string | null
  cdp_user_id: string | null
  wallet_address: string | null
  delegation_expires_at: string | null
}

interface GrantRow {
  id: string
  agent_issuer: string
  agent_subject: string
  name: string
  total_limit: string
  spent_total: string
  per_transaction_limit: string
  period_kind: AgentGrant['periodKind']
  period_limit: string | null
  period_spent: string
  expires_at: string | null
  revoked_at: string | null
}

interface BudgetRequestRow {
  id: string
  owner_issuer: string
  owner_subject: string
  agent_issuer: string
  agent_subject: string
  requested_name: string | null
  status: BudgetRequestState['status']
  approval_token_hash: string
  grant_id: string | null
  expires_at: string
}

export async function getOrCreateUser(db: D1Database, principal: HumanPrincipal): Promise<WalletUser> {
  const found = await findUser(db, principal.issuer, principal.subject)
  if (found) return toUser(found)
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO wallet_user (id, issuer, subject, email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, principal.issuer, principal.subject, principal.email, now, now)
    .run()
  return {
    id,
    issuer: principal.issuer,
    subject: principal.subject,
    email: principal.email,
    cdpUserId: null,
    walletAddress: null,
    delegationExpiresAt: null,
  }
}

export async function findUser(db: D1Database, issuer: string, subject: string) {
  return db
    .prepare(
      `SELECT id, issuer, subject, email, cdp_user_id, wallet_address, delegation_expires_at
       FROM wallet_user WHERE issuer = ? AND subject = ?`,
    )
    .bind(issuer, subject)
    .first<UserRow>()
}

export async function overview(db: D1Database, user: WalletUser): Promise<WalletOverview> {
  const [grants, payments] = await Promise.all([
    db
      .prepare(
        `SELECT id, agent_issuer, agent_subject, name, total_limit, spent_total,
                per_transaction_limit, period_kind, period_limit, period_spent, expires_at, revoked_at
         FROM agent_grant WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .bind(user.id)
      .all<GrantRow>(),
    db
      .prepare(
        `SELECT id, amount, pay_to, resource, status, created_at
         FROM payment WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(user.id)
      .all<{
        id: string
        amount: string
        pay_to: string
        resource: string
        status: WalletOverview['payments'][number]['status']
        created_at: string
      }>(),
  ])
  return {
    user,
    grants: grants.results.map(toGrant),
    payments: payments.results.map((row) => ({
      id: row.id,
      amount: row.amount,
      payTo: row.pay_to,
      resource: row.resource,
      status: row.status,
      createdAt: row.created_at,
    })),
  }
}

export async function updateWallet(
  db: D1Database,
  userId: string,
  input: { cdpUserId: string; address: string; delegationExpiresAt: string | null },
) {
  await db
    .prepare(
      `UPDATE wallet_user
       SET cdp_user_id = ?, wallet_address = ?, delegation_expires_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.cdpUserId, input.address.toLowerCase(), input.delegationExpiresAt, new Date().toISOString(), userId)
    .run()
}

export async function createBudgetRequest(
  db: D1Database,
  principal: AgentPrincipal,
  appOrigin: string,
  requestedName?: string,
): Promise<BudgetRequestState> {
  const user = await findUser(db, principal.owner.issuer, principal.owner.subject)
  if (user) {
    const active = await db
      .prepare(
        `SELECT id, expires_at FROM agent_grant
         WHERE user_id = ? AND agent_issuer = ? AND agent_subject = ? AND revoked_at IS NULL`,
      )
      .bind(user.id, principal.agent.issuer, principal.agent.subject)
      .first<{ id: string; expires_at: string | null }>()
    if (active && (!active.expires_at || new Date(active.expires_at).getTime() > Date.now())) {
      return {
        id: active.id,
        status: 'approved',
        expiresAt: active.expires_at ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        grantId: active.id,
      }
    }
  }

  const id = crypto.randomUUID()
  const approvalToken = randomToken()
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  await db
    .prepare(
      `UPDATE budget_request SET status = 'expired', updated_at = ?
       WHERE owner_issuer = ? AND owner_subject = ? AND agent_issuer = ? AND agent_subject = ?
         AND status = 'pending'`,
    )
    .bind(
      now,
      principal.owner.issuer,
      principal.owner.subject,
      principal.agent.issuer,
      principal.agent.subject,
    )
    .run()
  await db
    .prepare(
      `INSERT INTO budget_request (
         id, owner_issuer, owner_subject, agent_issuer, agent_subject, requested_name,
         status, approval_token_hash, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
    )
    .bind(
      id,
      principal.owner.issuer,
      principal.owner.subject,
      principal.agent.issuer,
      principal.agent.subject,
      requestedName ?? null,
      await hashToken(approvalToken),
      expiresAt,
      now,
      now,
    )
    .run()
  return {
    id,
    status: 'pending',
    expiresAt,
    grantId: null,
    approvalUrl: `${appOrigin}/authorize#request=${encodeURIComponent(id)}&token=${encodeURIComponent(approvalToken)}`,
    interval: 3,
  }
}

export async function getBudgetRequestForAgent(
  db: D1Database,
  requestId: string,
  principal: AgentPrincipal,
): Promise<BudgetRequestState> {
  const row = await findBudgetRequest(db, requestId)
  if (
    !row ||
    row.owner_issuer !== principal.owner.issuer ||
    row.owner_subject !== principal.owner.subject ||
    row.agent_issuer !== principal.agent.issuer ||
    row.agent_subject !== principal.agent.subject
  ) {
    throw notFound('Budget request was not found.')
  }
  await expireBudgetRequest(db, row)
  return toBudgetState(row)
}

export async function getBudgetRequestForApproval(
  db: D1Database,
  requestId: string,
  approvalToken: string,
  principal: HumanPrincipal,
): Promise<BudgetRequestDetail> {
  const row = await findBudgetRequest(db, requestId)
  if (
    !row ||
    row.owner_issuer !== principal.issuer ||
    row.owner_subject !== principal.subject ||
    row.approval_token_hash !== (await hashToken(approvalToken))
  ) {
    throw notFound('Budget request was not found.')
  }
  await expireBudgetRequest(db, row)
  return {
    ...toBudgetState(row),
    agentIssuer: row.agent_issuer,
    agentSubject: row.agent_subject,
    requestedName: row.requested_name,
  }
}

export async function decideBudgetRequest(
  db: D1Database,
  requestId: string,
  principal: HumanPrincipal,
  input: BudgetDecisionInput,
) {
  const row = await findBudgetRequest(db, requestId)
  if (
    !row ||
    row.owner_issuer !== principal.issuer ||
    row.owner_subject !== principal.subject ||
    row.approval_token_hash !== (await hashToken(input.approvalToken))
  ) {
    throw notFound('Budget request was not found.')
  }
  await expireBudgetRequest(db, row)
  if (row.status !== 'pending') throw conflict('Budget request is no longer pending.')
  const now = new Date().toISOString()
  if (input.decision === 'deny') {
    await db
      .prepare(
        `UPDATE budget_request SET status = 'denied', decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(now, now, row.id)
      .run()
    return { status: 'denied' as const, grantId: null }
  }

  validateGrantPolicy(input)
  const user = await getOrCreateUser(db, principal)
  const existing = await db
    .prepare(
      `SELECT id FROM agent_grant
       WHERE user_id = ? AND agent_issuer = ? AND agent_subject = ?`,
    )
    .bind(user.id, row.agent_issuer, row.agent_subject)
    .first<{ id: string }>()
  const grantId = existing?.id ?? crypto.randomUUID()
  await db.batch([
    db
      .prepare(
        `INSERT INTO agent_grant (
           id, user_id, agent_issuer, agent_subject, name, total_limit, spent_total,
           per_transaction_limit, period_kind, period_limit, period_spent,
           period_started_at, expires_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, '0', ?, ?, NULL, ?, ?)
         ON CONFLICT(user_id, agent_issuer, agent_subject) DO UPDATE SET
           name = excluded.name,
           total_limit = excluded.total_limit,
           spent_total = '0',
           per_transaction_limit = excluded.per_transaction_limit,
           period_kind = excluded.period_kind,
           period_limit = excluded.period_limit,
           period_spent = '0',
           period_started_at = excluded.period_started_at,
           expires_at = excluded.expires_at,
           revoked_at = NULL,
           updated_at = excluded.updated_at`,
      )
      .bind(
        grantId,
        user.id,
        row.agent_issuer,
        row.agent_subject,
        input.name,
        input.totalLimit,
        input.perTransactionLimit,
        input.periodKind,
        input.periodLimit,
        periodStart(input.periodKind),
        input.expiresAt,
        now,
        now,
      ),
    db
      .prepare(
        `UPDATE budget_request
         SET status = 'approved', grant_id = ?, decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .bind(grantId, now, now, row.id),
  ])
  return { status: 'approved' as const, grantId }
}

export async function revokeGrant(db: D1Database, userId: string, grantId: string) {
  const result = await db
    .prepare('UPDATE agent_grant SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .bind(new Date().toISOString(), new Date().toISOString(), grantId, userId)
    .run()
  if (result.meta.changes !== 1) throw notFound('Active grant was not found.')
}

export async function reservePayment(
  db: D1Database,
  input: {
    owner: { issuer: string; subject: string }
    agent: { issuer: string; subject: string }
    requirementHash: string
    network: string
    asset: string
    amount: string
    payTo: string
    resource: string
  },
) {
  const user = await findUser(db, input.owner.issuer, input.owner.subject)
  if (!user) throw forbidden('The Agent owner has no Wallet account.')
  if (!user.cdp_user_id || !user.wallet_address) throw forbidden('The Wallet account is not provisioned.')
  if (!user.delegation_expires_at || new Date(user.delegation_expires_at).getTime() <= Date.now()) {
    throw forbidden('CDP delegated signing is not active.')
  }
  const grant = await db
    .prepare(
      `SELECT id, total_limit, spent_total, per_transaction_limit, period_kind,
              period_limit, period_spent, period_started_at, expires_at
       FROM agent_grant
       WHERE user_id = ? AND agent_issuer = ? AND agent_subject = ? AND revoked_at IS NULL`,
    )
    .bind(user.id, input.agent.issuer, input.agent.subject)
    .first<{
      id: string
      total_limit: string
      spent_total: string
      per_transaction_limit: string
      period_kind: AgentGrant['periodKind']
      period_limit: string | null
      period_spent: string
      period_started_at: string
      expires_at: string | null
    }>()
  if (!grant) throw forbidden('The Agent has no active Wallet grant.')
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) throw forbidden('The Wallet grant expired.')

  const amount = BigInt(input.amount)
  if (amount > BigInt(grant.per_transaction_limit)) throw forbidden('Payment exceeds the per-transaction limit.')
  const newPeriod = shouldResetPeriod(grant.period_kind, grant.period_started_at)
  const periodSpent = newPeriod ? 0n : BigInt(grant.period_spent)
  if (grant.period_limit && periodSpent + amount > BigInt(grant.period_limit)) {
    throw forbidden('Payment exceeds the periodic limit.')
  }

  const paymentId = crypto.randomUUID()
  const now = new Date().toISOString()
  try {
    await db
      .prepare(
        `INSERT INTO payment (
           id, user_id, grant_id, requirement_hash, network, asset, amount, pay_to,
           resource, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`,
      )
      .bind(
        paymentId,
        user.id,
        grant.id,
        input.requirementHash,
        input.network,
        input.asset,
        input.amount,
        input.payTo.toLowerCase(),
        input.resource,
        now,
        now,
      )
      .run()
  } catch {
    throw conflict('This payment requirement was already processed.')
  }

  const update = await db
    .prepare(
      `UPDATE agent_grant
       SET spent_total = CAST(CAST(spent_total AS INTEGER) + ? AS TEXT),
           period_spent = CAST(? + ? AS TEXT),
           period_started_at = ?,
           updated_at = ?
       WHERE id = ?
         AND CAST(spent_total AS INTEGER) + ? <= CAST(total_limit AS INTEGER)`,
    )
    .bind(
      input.amount,
      periodSpent.toString(),
      input.amount,
      newPeriod ? periodStart(grant.period_kind) : grant.period_started_at,
      now,
      grant.id,
      input.amount,
    )
    .run()
  if (update.meta.changes !== 1) {
    await db.prepare("UPDATE payment SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind(
      'Payment exceeds the total limit.',
      now,
      paymentId,
    ).run()
    throw forbidden('Payment exceeds the total limit.')
  }
  return { paymentId, user: toUser(user), grantId: grant.id }
}

export async function completePayment(db: D1Database, paymentId: string, payload: unknown) {
  await db
    .prepare("UPDATE payment SET status = 'signed', payment_payload = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(payload), new Date().toISOString(), paymentId)
    .run()
}

export async function failPayment(db: D1Database, paymentId: string, grantId: string, amount: string, error: string) {
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare("UPDATE payment SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'reserved'")
      .bind(error, now, paymentId),
    db
      .prepare(
        `UPDATE agent_grant
         SET spent_total = CAST(CAST(spent_total AS INTEGER) - ? AS TEXT),
             period_spent = CAST(CAST(period_spent AS INTEGER) - ? AS TEXT),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(amount, amount, now, grantId),
  ])
}

function toUser(row: UserRow): WalletUser {
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    cdpUserId: row.cdp_user_id,
    walletAddress: row.wallet_address,
    delegationExpiresAt: row.delegation_expires_at,
  }
}

function toGrant(row: GrantRow): AgentGrant {
  return {
    id: row.id,
    agentIssuer: row.agent_issuer,
    agentSubject: row.agent_subject,
    name: row.name,
    totalLimit: row.total_limit,
    spentTotal: row.spent_total,
    perTransactionLimit: row.per_transaction_limit,
    periodKind: row.period_kind,
    periodLimit: row.period_limit,
    periodSpent: row.period_spent,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  }
}

async function findBudgetRequest(db: D1Database, requestId: string) {
  return db
    .prepare(
      `SELECT id, owner_issuer, owner_subject, agent_issuer, agent_subject, requested_name,
              status, approval_token_hash, grant_id, expires_at
       FROM budget_request WHERE id = ?`,
    )
    .bind(requestId)
    .first<BudgetRequestRow>()
}

async function expireBudgetRequest(db: D1Database, row: BudgetRequestRow) {
  if (row.status !== 'pending' || new Date(row.expires_at).getTime() > Date.now()) return
  await db
    .prepare("UPDATE budget_request SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(new Date().toISOString(), row.id)
    .run()
  row.status = 'expired'
}

function toBudgetState(row: BudgetRequestRow): BudgetRequestState {
  return {
    id: row.id,
    status: row.status,
    expiresAt: row.expires_at,
    grantId: row.grant_id,
  }
}

function validateGrantPolicy(input: {
  totalLimit: string
  perTransactionLimit: string
  periodKind: AgentGrant['periodKind']
  periodLimit: string | null
}) {
  if (BigInt(input.perTransactionLimit) > BigInt(input.totalLimit)) {
    throw conflict('Per-transaction limit cannot exceed total limit.')
  }
  if (input.periodKind === 'none' && input.periodLimit !== null) {
    throw conflict('A grant without a period cannot define a period limit.')
  }
  if (input.periodKind !== 'none' && input.periodLimit === null) {
    throw conflict('A periodic grant requires a period limit.')
  }
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return base64url(bytes)
}

async function hashToken(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64url(bytes: Uint8Array) {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function periodStart(kind: AgentGrant['periodKind']) {
  const now = new Date()
  if (kind === 'daily') now.setUTCHours(0, 0, 0, 0)
  if (kind === 'monthly') {
    now.setUTCDate(1)
    now.setUTCHours(0, 0, 0, 0)
  }
  return now.toISOString()
}

function shouldResetPeriod(kind: AgentGrant['periodKind'], startedAt: string) {
  if (kind === 'none') return false
  return new Date(startedAt).getTime() < new Date(periodStart(kind)).getTime()
}
