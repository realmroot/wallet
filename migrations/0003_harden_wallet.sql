ALTER TABLE agent_grant ADD COLUMN paused_at TEXT;

CREATE UNIQUE INDEX wallet_user_cdp_user_idx
  ON wallet_user(cdp_user_id)
  WHERE cdp_user_id IS NOT NULL;
CREATE UNIQUE INDEX wallet_user_address_idx
  ON wallet_user(wallet_address)
  WHERE wallet_address IS NOT NULL;
CREATE INDEX dpop_replay_expiry_idx ON dpop_replay(expires_at);

ALTER TABLE payment RENAME TO payment_legacy;

CREATE TABLE payment (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id),
  grant_id TEXT NOT NULL REFERENCES agent_grant(id),
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
  UNIQUE (grant_id, idempotency_key)
);

INSERT INTO payment (
  id, user_id, grant_id, idempotency_key, requirement_hash, network, asset,
  amount, pay_to, resource, status, payment_payload, settlement_response,
  error, created_at, updated_at
)
SELECT
  id, user_id, grant_id, requirement_hash, requirement_hash, network, asset,
  amount, pay_to, resource, status, payment_payload, settlement_response,
  error, created_at, updated_at
FROM payment_legacy;

DROP TABLE payment_legacy;

CREATE INDEX payment_user_created_idx ON payment(user_id, created_at DESC);
CREATE INDEX payment_grant_created_idx ON payment(grant_id, created_at DESC);
CREATE INDEX payment_stale_reservation_idx
  ON payment(status, reservation_expires_at)
  WHERE status = 'reserved';
CREATE INDEX payment_expired_authorization_idx
  ON payment(status, authorization_expires_at)
  WHERE status = 'signed';

CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id) ON DELETE CASCADE,
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX audit_event_user_created_idx
  ON audit_event(user_id, created_at DESC);
