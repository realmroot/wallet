PRAGMA defer_foreign_keys = ON;

CREATE TABLE agent_grant_with_mode (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id) ON DELETE CASCADE,
  agent_issuer TEXT NOT NULL,
  agent_subject TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('production', 'sandbox')),
  name TEXT NOT NULL,
  total_limit TEXT NOT NULL,
  spent_total TEXT NOT NULL DEFAULT '0',
  per_transaction_limit TEXT NOT NULL,
  period_kind TEXT NOT NULL CHECK (period_kind IN ('none', 'daily', 'monthly')),
  period_limit TEXT,
  period_spent TEXT NOT NULL DEFAULT '0',
  period_started_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paused_at TEXT,
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  allowed_recipients TEXT NOT NULL DEFAULT '[]',
  UNIQUE (user_id, agent_issuer, agent_subject, mode)
);

INSERT INTO agent_grant_with_mode (
  id, user_id, agent_issuer, agent_subject, mode, name, total_limit,
  spent_total, per_transaction_limit, period_kind, period_limit, period_spent,
  period_started_at, expires_at, revoked_at, created_at, updated_at, paused_at,
  allowed_origins, allowed_recipients
)
SELECT
  id, user_id, agent_issuer, agent_subject, 'production', name, total_limit,
  spent_total, per_transaction_limit, period_kind, period_limit, period_spent,
  period_started_at, expires_at, revoked_at, created_at, updated_at, paused_at,
  allowed_origins, allowed_recipients
FROM agent_grant;

CREATE TABLE budget_request_with_mode (
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  agent_issuer TEXT NOT NULL,
  agent_subject TEXT NOT NULL,
  requested_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  approval_token_hash TEXT NOT NULL UNIQUE,
  grant_id TEXT REFERENCES agent_grant_with_mode(id),
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'production'
    CHECK (mode IN ('production', 'sandbox'))
);

INSERT INTO budget_request_with_mode (
  id, owner_issuer, owner_subject, agent_issuer, agent_subject, requested_name,
  status, approval_token_hash, grant_id, expires_at, decided_at, created_at,
  updated_at, mode
)
SELECT
  id, owner_issuer, owner_subject, agent_issuer, agent_subject, requested_name,
  status, approval_token_hash, grant_id, expires_at, decided_at, created_at,
  updated_at, 'production'
FROM budget_request;

CREATE TABLE payment_with_mode (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id),
  grant_id TEXT NOT NULL REFERENCES agent_grant_with_mode(id),
  idempotency_key TEXT NOT NULL,
  requirement_hash TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'signed', 'settled', 'failed')),
  payment_payload TEXT,
  settlement_response TEXT,
  transaction_hash TEXT,
  reservation_expires_at TEXT,
  authorization_expires_at TEXT,
  settled_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  account_id TEXT REFERENCES wallet_account(id),
  mode TEXT NOT NULL DEFAULT 'production'
    CHECK (mode IN ('production', 'sandbox')),
  UNIQUE (grant_id, idempotency_key)
);

INSERT INTO payment_with_mode (
  id, user_id, grant_id, idempotency_key, requirement_hash, network, asset,
  amount, pay_to, resource, status, payment_payload, settlement_response,
  transaction_hash, reservation_expires_at, authorization_expires_at,
  settled_at, error, created_at, updated_at, account_id, mode
)
SELECT
  id, user_id, grant_id, idempotency_key, requirement_hash, network, asset,
  amount, pay_to, resource, status, payment_payload, settlement_response,
  transaction_hash, reservation_expires_at, authorization_expires_at,
  settled_at, error, created_at, updated_at, account_id, 'production'
FROM payment;

DROP TABLE budget_request;
DROP TABLE payment;
DROP TABLE agent_grant;

ALTER TABLE agent_grant_with_mode RENAME TO agent_grant;
ALTER TABLE budget_request_with_mode RENAME TO budget_request;
ALTER TABLE payment_with_mode RENAME TO payment;

CREATE INDEX agent_grant_user_created_idx
  ON agent_grant(user_id, created_at DESC);
CREATE INDEX budget_request_agent_idx
  ON budget_request(owner_issuer, owner_subject, agent_issuer, agent_subject, created_at DESC);
CREATE INDEX payment_user_created_idx
  ON payment(user_id, created_at DESC);
CREATE INDEX payment_grant_created_idx
  ON payment(grant_id, created_at DESC);
CREATE INDEX payment_stale_reservation_idx
  ON payment(status, reservation_expires_at)
  WHERE status = 'reserved';
CREATE INDEX payment_expired_authorization_idx
  ON payment(status, authorization_expires_at)
  WHERE status = 'signed';
CREATE INDEX idx_payment_account
  ON payment(account_id);
CREATE INDEX payment_user_mode_created_idx
  ON payment(user_id, mode, created_at DESC);
