PRAGMA defer_foreign_keys = ON;

ALTER TABLE budget_request
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'production'
  CHECK (mode IN ('production', 'sandbox'));

ALTER TABLE payment
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'production'
  CHECK (mode IN ('production', 'sandbox'));

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

DROP TABLE agent_grant;
ALTER TABLE agent_grant_with_mode RENAME TO agent_grant;

CREATE INDEX agent_grant_user_created_idx
  ON agent_grant(user_id, created_at DESC);

CREATE INDEX payment_user_mode_created_idx
  ON payment(user_id, mode, created_at DESC);
