CREATE TABLE wallet_account (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES wallet_user(id) ON DELETE CASCADE,
  family TEXT NOT NULL CHECK (family IN ('evm', 'solana')),
  address TEXT NOT NULL,
  delegation_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (user_id, family),
  UNIQUE (family, address)
);

INSERT INTO wallet_account (
  id, user_id, family, address, delegation_expires_at, created_at, updated_at
)
SELECT
  lower(hex(randomblob(4))) || '-' ||
  lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  substr('89ab', abs(random()) % 4 + 1, 1) ||
  substr(lower(hex(randomblob(2))), 2) || '-' ||
  lower(hex(randomblob(6))),
  id,
  'evm',
  lower(wallet_address),
  delegation_expires_at,
  updated_at,
  updated_at
FROM wallet_user
WHERE wallet_address IS NOT NULL;

ALTER TABLE payment ADD COLUMN account_id TEXT REFERENCES wallet_account(id);

UPDATE payment
SET account_id = (
  SELECT wallet_account.id
  FROM wallet_account
  WHERE wallet_account.user_id = payment.user_id
    AND wallet_account.family = 'evm'
);

CREATE INDEX idx_wallet_account_user ON wallet_account(user_id);
CREATE INDEX idx_payment_account ON payment(account_id);
