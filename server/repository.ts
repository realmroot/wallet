import type {
  AgentPayment,
  AgentGrant,
  BudgetDecisionInput,
  BudgetRequestDetail,
  BudgetRequestState,
  GrantActionInput,
  SettlementResponse,
  UpdateGrantInput,
  WalletRuntime,
  WalletOverview,
  WalletAccount,
  WalletUser,
} from '../shared/contracts'
import type { AgentPrincipal, HumanPrincipal } from './auth'
import { conflict, forbidden, notFound } from './errors'
import { walletNetworkDefinition } from './network'

interface UserRow {
  id: string
  issuer: string
  subject: string
  email: string | null
  cdp_user_id: string | null
  paused_at: string | null
}

interface AccountRow {
  id: string
  family: WalletAccount['family']
  address: string
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
  allowed_origins: string
  allowed_recipients: string
  expires_at: string | null
  paused_at: string | null
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
  if (found) return hydrateUser(db, found)
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
    accounts: [],
    pausedAt: null,
  }
}

export async function findUser(db: D1Database, issuer: string, subject: string) {
  return db
    .prepare(
      `SELECT id, issuer, subject, email, cdp_user_id, paused_at
       FROM wallet_user WHERE issuer = ? AND subject = ?`,
    )
    .bind(issuer, subject)
    .first<UserRow>()
}

export async function overview(
  db: D1Database,
  user: WalletUser,
  runtime: WalletRuntime,
): Promise<WalletOverview> {
  const [grants, payments, auditEvents] = await Promise.all([
    db
      .prepare(
        `SELECT id, agent_issuer, agent_subject, name, total_limit, spent_total,
                per_transaction_limit, period_kind, period_limit, period_spent,
                allowed_origins, allowed_recipients, expires_at, paused_at, revoked_at
         FROM agent_grant WHERE user_id = ? ORDER BY created_at DESC`,
      )
      .bind(user.id)
      .all<GrantRow>(),
    db
      .prepare(
        `SELECT id, network, amount, pay_to, resource, status, transaction_hash, error, created_at
         FROM payment WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      )
      .bind(user.id)
      .all<{
        id: string
        network: string
        amount: string
        pay_to: string
        resource: string
        status: WalletOverview['payments'][number]['status']
        transaction_hash: string | null
        error: string | null
        created_at: string
      }>(),
    db
      .prepare(
        `SELECT id, actor_kind, actor_subject, action, target_type, target_id,
                metadata, created_at
         FROM audit_event WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .bind(user.id)
      .all<{
        id: string
        actor_kind: WalletOverview['auditEvents'][number]['actorKind']
        actor_subject: string
        action: string
        target_type: string
        target_id: string
        metadata: string | null
        created_at: string
      }>(),
  ])
  return {
    user,
    grants: grants.results.map(toGrant),
    payments: payments.results.map((row) => ({
      id: row.id,
      network: row.network,
      amount: row.amount,
      payTo: row.pay_to,
      resource: row.resource,
      status: row.status,
      transactionHash: row.transaction_hash,
      error: row.error,
      createdAt: row.created_at,
    })),
    auditEvents: auditEvents.results.map((row) => ({
      id: row.id,
      actorKind: row.actor_kind,
      actorSubject: row.actor_subject,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
      createdAt: row.created_at,
    })),
    runtime,
  }
}

export async function getAgentWalletState(db: D1Database, principal: AgentPrincipal) {
  const row = await findUser(db, principal.owner.issuer, principal.owner.subject)
  if (!row) return { user: null, grant: null }

  const grant = await db
    .prepare(
      `SELECT id, agent_issuer, agent_subject, name, total_limit, spent_total,
              per_transaction_limit, period_kind, period_limit, period_spent,
              period_started_at, allowed_origins, allowed_recipients, expires_at,
              paused_at, revoked_at
       FROM agent_grant
       WHERE user_id = ? AND agent_issuer = ? AND agent_subject = ? AND revoked_at IS NULL`,
    )
    .bind(row.id, principal.agent.issuer, principal.agent.subject)
    .first<GrantRow & { period_started_at: string }>()
  if (!grant) return { user: await hydrateUser(db, row), grant: null }

  if (shouldResetPeriod(grant.period_kind, grant.period_started_at)) {
    grant.period_spent = '0'
  }
  return { user: await hydrateUser(db, row), grant: toGrant(grant) }
}

export async function updateWallet(
  db: D1Database,
  userId: string,
  input: {
    cdpUserId: string
    accounts: Array<{
      family: WalletAccount['family']
      address: string
      delegationExpiresAt: string
    }>
  },
) {
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare('UPDATE wallet_user SET cdp_user_id = ?, updated_at = ? WHERE id = ?')
      .bind(input.cdpUserId, now, userId),
    ...input.accounts.map((account) =>
      db
        .prepare(
          `INSERT INTO wallet_account (
             id, user_id, family, address, delegation_expires_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, family) DO UPDATE SET
             address = excluded.address,
             delegation_expires_at = excluded.delegation_expires_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          account.family,
          normalizeAddress(account.family, account.address),
          account.delegationExpiresAt,
          now,
          now,
        ),
    ),
  ])
}

export async function actOnWallet(
  db: D1Database,
  userId: string,
  action: 'pause' | 'resume',
) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE wallet_user
       SET paused_at = ?, updated_at = ?
       WHERE id = ?
         AND ((? = 'pause' AND paused_at IS NULL) OR (? = 'resume' AND paused_at IS NOT NULL))`,
    )
    .bind(action === 'pause' ? now : null, now, userId, action, action)
    .run()
  if (result.meta.changes !== 1) {
    throw conflict(`The Wallet is already ${action === 'pause' ? 'paused' : 'active'}.`)
  }
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
        requestId: null,
        budgetId: active.id,
        status: 'approved',
        expiresAt: active.expires_at ?? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
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
    requestId: id,
    budgetId: null,
    status: 'pending',
    expiresAt,
    approvalUrl: `${appOrigin}/authorize#request=${encodeURIComponent(id)}&token=${encodeURIComponent(approvalToken)}`,
    pollIntervalSeconds: 3,
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
           period_started_at, allowed_origins, allowed_recipients, expires_at,
           paused_at, revoked_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, '0', ?, ?, ?, '0', ?, ?, ?, ?, NULL, NULL, ?, ?)
         ON CONFLICT(user_id, agent_issuer, agent_subject) DO UPDATE SET
           name = excluded.name,
           total_limit = excluded.total_limit,
           per_transaction_limit = excluded.per_transaction_limit,
           period_kind = excluded.period_kind,
           period_limit = excluded.period_limit,
           allowed_origins = excluded.allowed_origins,
           allowed_recipients = excluded.allowed_recipients,
           expires_at = excluded.expires_at,
           paused_at = NULL,
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
        JSON.stringify(input.allowedOrigins),
        JSON.stringify(input.allowedRecipients.map(normalizePolicyAddress)),
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

export async function updateGrantPolicy(
  db: D1Database,
  userId: string,
  grantId: string,
  input: UpdateGrantInput,
) {
  validateGrantPolicy(input)
  const grant = await db
    .prepare(
      `SELECT spent_total FROM agent_grant
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(grantId, userId)
    .first<{ spent_total: string }>()
  if (!grant) throw notFound('Active grant was not found.')
  if (BigInt(input.totalLimit) < BigInt(grant.spent_total)) {
    throw conflict('Total limit cannot be lower than the amount already spent.')
  }

  await db
    .prepare(
      `UPDATE agent_grant
       SET name = ?, total_limit = ?, per_transaction_limit = ?,
           period_spent = CASE WHEN period_kind != ? THEN '0' ELSE period_spent END,
           period_started_at = CASE WHEN period_kind != ? THEN ? ELSE period_started_at END,
           period_kind = ?, period_limit = ?, allowed_origins = ?,
           allowed_recipients = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(
      input.name,
      input.totalLimit,
      input.perTransactionLimit,
      input.periodKind,
      input.periodKind,
      periodStart(input.periodKind),
      input.periodKind,
      input.periodLimit,
      JSON.stringify(input.allowedOrigins),
      JSON.stringify(input.allowedRecipients.map(normalizePolicyAddress)),
      input.expiresAt,
      new Date().toISOString(),
      grantId,
      userId,
    )
    .run()
}

export async function actOnGrant(
  db: D1Database,
  userId: string,
  grantId: string,
  input: GrantActionInput,
) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE agent_grant
       SET paused_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL
         AND ((? = 'pause' AND paused_at IS NULL) OR (? = 'resume' AND paused_at IS NOT NULL))`,
    )
    .bind(input.action === 'pause' ? now : null, now, grantId, userId, input.action, input.action)
    .run()
  if (result.meta.changes !== 1) {
    throw conflict(`The grant is already ${input.action === 'pause' ? 'paused' : 'active'}.`)
  }
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
    idempotencyKey: string
  },
) {
  const user = await findUser(db, input.owner.issuer, input.owner.subject)
  if (!user) throw forbidden('The Agent owner has no Wallet account.')
  if (!user.cdp_user_id) throw forbidden('The Wallet account is not provisioned.')
  const family = walletNetworkDefinition(input.network).family
  const account = await findAccount(db, user.id, family)
  if (!account) throw forbidden(`The Wallet has no ${family === 'evm' ? 'EVM' : 'Solana'} account.`)
  if (user.paused_at) throw forbidden('The Wallet is paused.')
  if (
    !account.delegation_expires_at ||
    new Date(account.delegation_expires_at).getTime() <= Date.now()
  ) {
    throw forbidden('CDP delegated signing is not active.')
  }
  const grant = await db
    .prepare(
      `SELECT id, total_limit, spent_total, per_transaction_limit, period_kind,
              period_limit, period_spent, period_started_at, allowed_origins,
              allowed_recipients, expires_at, paused_at
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
      allowed_origins: string
      allowed_recipients: string
      expires_at: string | null
      paused_at: string | null
    }>()
  if (!grant) throw forbidden('The Agent has no active Wallet grant.')
  if (grant.paused_at) throw forbidden('The Wallet grant is paused.')
  if (grant.expires_at && new Date(grant.expires_at).getTime() <= Date.now()) throw forbidden('The Wallet grant expired.')
  const allowedOrigins = parseStringArray(grant.allowed_origins)
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(new URL(input.resource).origin)) {
    throw forbidden('The merchant is not allowed by this Wallet grant.')
  }
  const allowedRecipients = parseStringArray(grant.allowed_recipients)
  const normalizedPayTo = normalizeAddress(family, input.payTo)
  if (allowedRecipients.length > 0 && !allowedRecipients.includes(normalizedPayTo)) {
    throw forbidden('The payment recipient is not allowed by this Wallet grant.')
  }

  const existing = await findIdempotentPayment(db, grant.id, input.idempotencyKey)
  if (existing) {
    if (existing.requirement_hash !== input.requirementHash) {
      throw conflict('The idempotency key was already used for a different payment requirement.')
    }
    if (existing.status === 'signed' || existing.status === 'settled') {
      if (!existing.payment_payload) throw conflict('The existing payment payload is unavailable.')
      return {
        kind: 'signed' as const,
        paymentId: existing.id,
        paymentPayload: JSON.parse(existing.payment_payload) as Record<string, unknown>,
      }
    }
    if (existing.status === 'failed') {
      throw conflict('The idempotent payment attempt previously failed. Use a new idempotency key.')
    }
    if (
      existing.reservation_expires_at &&
      new Date(existing.reservation_expires_at).getTime() <= Date.now()
    ) {
      await expireReservation(db, existing.id, grant.id, existing.amount)
      throw conflict('The idempotent payment reservation expired. Use a new idempotency key.')
    }
    return {
      kind: 'reserved' as const,
      paymentId: existing.id,
      user: await hydrateUser(db, user),
      account: toAccount(account),
      grantId: grant.id,
      replayed: true,
    }
  }

  const amount = BigInt(input.amount)
  if (amount > BigInt(grant.per_transaction_limit)) throw forbidden('Payment exceeds the per-transaction limit.')
  if (BigInt(grant.spent_total) + amount > BigInt(grant.total_limit)) {
    throw forbidden('Payment exceeds the total limit.')
  }
  const newPeriod = shouldResetPeriod(grant.period_kind, grant.period_started_at)
  const periodSpent = newPeriod ? 0n : BigInt(grant.period_spent)
  if (grant.period_limit && periodSpent + amount > BigInt(grant.period_limit)) {
    throw forbidden('Payment exceeds the periodic limit.')
  }

  const paymentId = crypto.randomUUID()
  const now = new Date().toISOString()
  const reservationExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString()
  const resetAt = periodStart(grant.period_kind)
  try {
    const [update] = await db.batch([
      db
        .prepare(
          `UPDATE agent_grant
           SET spent_total = CAST(CAST(spent_total AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
               period_spent = CAST(
                 CASE
                   WHEN period_kind != 'none' AND period_started_at < ? THEN CAST(? AS INTEGER)
                   ELSE CAST(period_spent AS INTEGER) + CAST(? AS INTEGER)
                 END AS TEXT
               ),
               period_started_at = CASE
                 WHEN period_kind != 'none' AND period_started_at < ? THEN ?
                 ELSE period_started_at
               END,
               updated_at = ?
           WHERE id = ? AND revoked_at IS NULL AND paused_at IS NULL
             AND (expires_at IS NULL OR expires_at > ?)
             AND CAST(? AS INTEGER) <= CAST(per_transaction_limit AS INTEGER)
             AND CAST(spent_total AS INTEGER) + CAST(? AS INTEGER) <= CAST(total_limit AS INTEGER)
             AND (
               period_limit IS NULL OR
               CASE
                 WHEN period_kind != 'none' AND period_started_at < ? THEN CAST(? AS INTEGER)
                 ELSE CAST(period_spent AS INTEGER) + CAST(? AS INTEGER)
               END <= CAST(period_limit AS INTEGER)
             )`,
        )
        .bind(
          input.amount,
          resetAt,
          input.amount,
          input.amount,
          resetAt,
          resetAt,
          now,
          grant.id,
          now,
          input.amount,
          input.amount,
          resetAt,
          input.amount,
          input.amount,
        ),
      db
        .prepare(
          `INSERT INTO payment (
             id, user_id, grant_id, account_id, idempotency_key, requirement_hash, network,
             asset, amount, pay_to, resource, status, reservation_expires_at,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, ?)`,
        )
        .bind(
          paymentId,
          user.id,
          grant.id,
          account.id,
          input.idempotencyKey,
          input.requirementHash,
          input.network,
          input.asset,
          input.amount,
          normalizedPayTo,
          input.resource,
          reservationExpiresAt,
          now,
          now,
        ),
    ])
    if (!update || update.meta.changes !== 1) {
      await db
        .prepare(
          `UPDATE payment SET status = 'failed', error = ?, updated_at = ?
           WHERE id = ? AND status = 'reserved'`,
        )
        .bind('The Wallet grant changed before the payment could be reserved.', now, paymentId)
        .run()
      throw forbidden('The payment no longer fits within the active Wallet grant.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
      const raced = await findIdempotentPayment(db, grant.id, input.idempotencyKey)
      if (raced?.requirement_hash === input.requirementHash) return reservePayment(db, input)
      throw conflict('The idempotency key was already used for another payment.')
    }
    throw error
  }
  return {
    kind: 'reserved' as const,
    paymentId,
    user: await hydrateUser(db, user),
    account: toAccount(account),
    grantId: grant.id,
    replayed: false,
  }
}

export async function completePayment(db: D1Database, paymentId: string, payload: unknown) {
  const serialized = JSON.stringify(payload)
  const result = await db
    .prepare(
      `UPDATE payment
       SET status = 'signed', payment_payload = ?, authorization_expires_at = ?,
           reservation_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'reserved'`,
    )
    .bind(serialized, paymentAuthorizationExpiry(payload), new Date().toISOString(), paymentId)
    .run()
  if (result.meta.changes === 1) return

  const existing = await db
    .prepare('SELECT status, payment_payload FROM payment WHERE id = ?')
    .bind(paymentId)
    .first<{ status: string; payment_payload: string | null }>()
  if (
    existing &&
    (existing.status === 'signed' || existing.status === 'settled') &&
    existing.payment_payload === serialized
  ) {
    return
  }
  throw conflict('The payment reservation expired before signing completed.')
}

export async function failPayment(db: D1Database, paymentId: string, grantId: string, amount: string, error: string) {
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare(
        `UPDATE agent_grant
         SET spent_total = CAST(MAX(0, CAST(spent_total AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             period_spent = CAST(MAX(0, CAST(period_spent AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM payment
           WHERE id = ? AND grant_id = ? AND status = 'reserved'
         )`,
      )
      .bind(amount, amount, now, grantId, paymentId, grantId),
    db
      .prepare("UPDATE payment SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'reserved'")
      .bind(error, now, paymentId),
  ])
}

export async function cleanupExpiredReservations(db: D1Database) {
  const now = new Date().toISOString()
  const stale = await db
    .prepare(
      `SELECT id, user_id, grant_id, amount FROM payment
       WHERE status = 'reserved' AND reservation_expires_at <= ?
       ORDER BY reservation_expires_at LIMIT 100`,
    )
    .bind(now)
    .all<{ id: string; user_id: string; grant_id: string; amount: string }>()
  if (stale.results.length === 0) return 0

  const statements = stale.results.flatMap((payment) => [
    db
      .prepare(
        `UPDATE agent_grant
         SET spent_total = CAST(MAX(0, CAST(spent_total AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             period_spent = CAST(MAX(0, CAST(period_spent AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM payment WHERE id = ? AND status = 'reserved'
         )`,
      )
      .bind(payment.amount, payment.amount, now, payment.grant_id, payment.id),
    db
      .prepare(
        `UPDATE payment
         SET status = 'failed', error = 'Payment signing reservation expired.', updated_at = ?
         WHERE id = ? AND status = 'reserved'`,
      )
      .bind(now, payment.id),
    db
      .prepare(
        `INSERT INTO audit_event (
           id, user_id, actor_kind, actor_subject, action, target_type,
           target_id, metadata, created_at
         )
         SELECT ?, ?, 'system', 'payment-maintenance', 'payment.reservation_expired',
                'payment', ?, NULL, ?
         WHERE EXISTS (
           SELECT 1 FROM payment
           WHERE id = ? AND status = 'failed'
             AND error = 'Payment signing reservation expired.' AND updated_at = ?
         )`,
      )
      .bind(crypto.randomUUID(), payment.user_id, payment.id, now, payment.id, now),
  ])
  await db.batch(statements)
  return stale.results.length
}

export async function listExpiredSignedPayments(db: D1Database) {
  return db
    .prepare(
      `SELECT p.id, p.user_id, p.grant_id, p.account_id, p.network, p.amount,
              p.asset, p.payment_payload, p.created_at, a.address AS wallet_address
       FROM payment p
       JOIN wallet_account a ON a.id = p.account_id
       WHERE p.status = 'signed' AND p.authorization_expires_at <= ?
       ORDER BY p.authorization_expires_at LIMIT 50`,
    )
    .bind(new Date().toISOString())
    .all<{
      id: string
      user_id: string
      grant_id: string
      account_id: string
      network: string
      amount: string
      asset: string
      payment_payload: string
      created_at: string
      wallet_address: string
    }>()
}

export async function releaseExpiredSignedPayment(
  db: D1Database,
  input: { paymentId: string; grantId: string; amount: string },
) {
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare(
        `UPDATE agent_grant
         SET spent_total = CAST(MAX(0, CAST(spent_total AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             period_spent = CAST(MAX(0, CAST(period_spent AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM payment WHERE id = ? AND status = 'signed'
         )`,
      )
      .bind(input.amount, input.amount, now, input.grantId, input.paymentId),
    db
      .prepare(
        `UPDATE payment
         SET status = 'failed', error = 'Signed authorization expired without settlement.',
             updated_at = ?
         WHERE id = ? AND status = 'signed'`,
      )
      .bind(now, input.paymentId),
  ])
}

export async function markExpiredPaymentSettled(
  db: D1Database,
  paymentId: string,
  transactionHash?: string,
) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE payment
       SET status = 'settled', transaction_hash = COALESCE(?, transaction_hash),
           settled_at = ?, error = NULL, updated_at = ?
       WHERE id = ? AND status = 'signed'`,
    )
    .bind(transactionHash ?? null, now, now, paymentId)
    .run()
}

export async function getPaymentForSettlement(
  db: D1Database,
  paymentId: string,
  principal: AgentPrincipal,
) {
  const payment = await db
    .prepare(
      `SELECT p.id, p.user_id, p.status, p.network, p.asset, p.amount, p.pay_to, p.resource,
              p.transaction_hash, a.address AS wallet_address
       FROM payment p
      JOIN wallet_user u ON u.id = p.user_id
       JOIN wallet_account a ON a.id = p.account_id
       JOIN agent_grant g ON g.id = p.grant_id
       WHERE p.id = ?
         AND u.issuer = ? AND u.subject = ?
         AND g.agent_issuer = ? AND g.agent_subject = ?`,
    )
    .bind(
      paymentId,
      principal.owner.issuer,
      principal.owner.subject,
      principal.agent.issuer,
      principal.agent.subject,
    )
    .first<{
      id: string
      user_id: string
      status: WalletOverview['payments'][number]['status']
      network: string
      asset: string
      amount: string
      pay_to: string
      resource: string
      transaction_hash: string | null
      wallet_address: string
    }>()
  if (!payment) throw notFound('Payment was not found.')
  if (payment.status !== 'signed' && payment.status !== 'settled') {
    throw conflict('Only a signed payment can accept a settlement response.')
  }
  return payment
}

export async function getPaymentForAgent(
  db: D1Database,
  paymentId: string,
  principal: AgentPrincipal,
): Promise<AgentPayment> {
  const payment = await db
    .prepare(
      `SELECT p.id, p.status, p.network, p.asset, p.amount, p.pay_to, p.resource,
              p.transaction_hash, p.error, p.authorization_expires_at, p.settled_at,
              p.created_at, p.updated_at
       FROM payment p
       JOIN wallet_user u ON u.id = p.user_id
       JOIN agent_grant g ON g.id = p.grant_id
       WHERE p.id = ?
         AND u.issuer = ? AND u.subject = ?
         AND g.agent_issuer = ? AND g.agent_subject = ?`,
    )
    .bind(
      paymentId,
      principal.owner.issuer,
      principal.owner.subject,
      principal.agent.issuer,
      principal.agent.subject,
    )
    .first<{
      id: string
      status: AgentPayment['status']
      network: string
      asset: string
      amount: string
      pay_to: string
      resource: string
      transaction_hash: string | null
      error: string | null
      authorization_expires_at: string | null
      settled_at: string | null
      created_at: string
      updated_at: string
    }>()
  if (!payment) throw notFound('Payment was not found.')
  return {
    paymentId: payment.id,
    status: payment.status,
    network: payment.network,
    asset: payment.asset,
    amount: payment.amount,
    payTo: payment.pay_to,
    resource: payment.resource,
    transactionHash: payment.transaction_hash,
    failureReason: payment.error,
    authorizationExpiresAt: payment.authorization_expires_at,
    settledAt: payment.settled_at,
    createdAt: payment.created_at,
    updatedAt: payment.updated_at,
  }
}

export async function recordSettlementFailure(
  db: D1Database,
  paymentId: string,
  response: SettlementResponse,
) {
  await db
    .prepare(
      `UPDATE payment
       SET settlement_response = ?, error = ?, updated_at = ?
       WHERE id = ? AND status = 'signed'`,
    )
    .bind(
      JSON.stringify(response),
      response.errorMessage ?? response.errorReason ?? 'Merchant settlement failed.',
      new Date().toISOString(),
      paymentId,
    )
    .run()
}

export async function settlePayment(
  db: D1Database,
  paymentId: string,
  response: SettlementResponse,
) {
  const now = new Date().toISOString()
  const result = await db
    .prepare(
      `UPDATE payment
       SET status = 'settled', settlement_response = ?, transaction_hash = ?,
           settled_at = ?, error = NULL, updated_at = ?
       WHERE id = ? AND status = 'signed'`,
    )
    .bind(JSON.stringify(response), response.transaction, now, now, paymentId)
    .run()
  if (result.meta.changes === 1) return

  const existing = await db
    .prepare('SELECT status, transaction_hash FROM payment WHERE id = ?')
    .bind(paymentId)
    .first<{ status: string; transaction_hash: string | null }>()
  if (existing?.status === 'settled' && existing.transaction_hash === response.transaction) return
  throw conflict('The payment settlement state changed.')
}

export async function recordAuditEvent(
  db: D1Database,
  input: {
    userId: string
    actorKind: 'human' | 'agent' | 'system'
    actorSubject: string
    action: string
    targetType: string
    targetId: string
    metadata?: Record<string, unknown>
  },
) {
  await db
    .prepare(
      `INSERT INTO audit_event (
         id, user_id, actor_kind, actor_subject, action, target_type,
         target_id, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.userId,
      input.actorKind,
      input.actorSubject,
      input.action,
      input.targetType,
      input.targetId,
      input.metadata ? JSON.stringify(input.metadata) : null,
      new Date().toISOString(),
    )
    .run()
}

async function findIdempotentPayment(db: D1Database, grantId: string, idempotencyKey: string) {
  return db
    .prepare(
      `SELECT id, requirement_hash, amount, status, payment_payload, reservation_expires_at
       FROM payment WHERE grant_id = ? AND idempotency_key = ?`,
    )
    .bind(grantId, idempotencyKey)
    .first<{
      id: string
      requirement_hash: string
      amount: string
      status: WalletOverview['payments'][number]['status']
      payment_payload: string | null
      reservation_expires_at: string | null
    }>()
}

async function expireReservation(
  db: D1Database,
  paymentId: string,
  grantId: string,
  amount: string,
) {
  const now = new Date().toISOString()
  await db.batch([
    db
      .prepare(
        `UPDATE agent_grant
         SET spent_total = CAST(MAX(0, CAST(spent_total AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             period_spent = CAST(MAX(0, CAST(period_spent AS INTEGER) - CAST(? AS INTEGER)) AS TEXT),
             updated_at = ?
         WHERE id = ? AND EXISTS (
           SELECT 1 FROM payment WHERE id = ? AND status = 'reserved'
         )`,
      )
      .bind(amount, amount, now, grantId, paymentId),
    db
      .prepare(
        `UPDATE payment
         SET status = 'failed', error = 'Payment signing reservation expired.', updated_at = ?
         WHERE id = ? AND status = 'reserved'`,
      )
      .bind(now, paymentId),
  ])
}

function paymentAuthorizationExpiry(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const authorization = (payload as { payload?: unknown }).payload
  if (!authorization || typeof authorization !== 'object') return null
  if (typeof (authorization as { transaction?: unknown }).transaction === 'string') {
    return new Date(Date.now() + 2 * 60 * 1000).toISOString()
  }
  const validBefore = (authorization as { authorization?: { validBefore?: unknown } }).authorization
    ?.validBefore
  if (typeof validBefore !== 'string' || !/^\d+$/.test(validBefore)) return null
  return new Date(Number(validBefore) * 1000).toISOString()
}

function rowToUser(row: UserRow): Omit<WalletUser, 'accounts'> {
  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    cdpUserId: row.cdp_user_id,
    pausedAt: row.paused_at,
  }
}

async function hydrateUser(db: D1Database, row: UserRow): Promise<WalletUser> {
  const accounts = await db
    .prepare(
      `SELECT id, family, address, delegation_expires_at
       FROM wallet_account WHERE user_id = ? ORDER BY family`,
    )
    .bind(row.id)
    .all<AccountRow>()
  return { ...rowToUser(row), accounts: accounts.results.map(toAccount) }
}

async function findAccount(db: D1Database, userId: string, family: WalletAccount['family']) {
  return db
    .prepare(
      `SELECT id, family, address, delegation_expires_at
       FROM wallet_account WHERE user_id = ? AND family = ?`,
    )
    .bind(userId, family)
    .first<AccountRow>()
}

function toAccount(row: AccountRow): WalletAccount {
  return {
    id: row.id,
    family: row.family,
    address: row.address,
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
    allowedOrigins: parseStringArray(row.allowed_origins),
    allowedRecipients: parseStringArray(row.allowed_recipients),
    expiresAt: row.expires_at,
    pausedAt: row.paused_at,
    revokedAt: row.revoked_at,
  }
}

function parseStringArray(value: string) {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Stored Wallet policy is invalid.')
  }
  return parsed as string[]
}

function normalizePolicyAddress(value: string) {
  return value.startsWith('0x') ? value.toLowerCase() : value
}

function normalizeAddress(family: WalletAccount['family'], value: string) {
  return family === 'evm' ? value.toLowerCase() : value
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
    requestId: row.id,
    budgetId: row.grant_id,
    status: row.status,
    expiresAt: row.expires_at,
  }
}

function validateGrantPolicy(input: {
  totalLimit: string
  perTransactionLimit: string
  periodKind: AgentGrant['periodKind']
  periodLimit: string | null
  expiresAt: string | null
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
  if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) {
    throw conflict('Grant expiration must be in the future.')
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
