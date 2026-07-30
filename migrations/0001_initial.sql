CREATE TABLE wallet_user (
  id TEXT PRIMARY KEY,
  issuer TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT,
  cdp_user_id TEXT,
  wallet_address TEXT,
  delegation_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE agent_grant (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id) ON DELETE CASCADE,
  agent_issuer TEXT NOT NULL,
  agent_subject TEXT NOT NULL,
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
  UNIQUE (user_id, agent_issuer, agent_subject)
);

CREATE TABLE payment (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id),
  grant_id TEXT NOT NULL REFERENCES agent_grant(id),
  requirement_hash TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  amount TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'signed', 'settled', 'failed')),
  payment_payload TEXT,
  settlement_response TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX payment_user_created_idx ON payment(user_id, created_at DESC);
CREATE INDEX payment_grant_created_idx ON payment(grant_id, created_at DESC);

CREATE TABLE dpop_replay (
  issuer TEXT NOT NULL,
  jti TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (issuer, jti)
);
