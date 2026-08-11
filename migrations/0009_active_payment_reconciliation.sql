ALTER TABLE payment ADD COLUMN next_reconciliation_at TEXT;
ALTER TABLE payment ADD COLUMN reconciliation_lease_until TEXT;
ALTER TABLE payment ADD COLUMN reconciliation_lease_id TEXT;
ALTER TABLE payment ADD COLUMN reconciliation_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment ADD COLUMN last_reconciliation_error TEXT;

UPDATE payment
SET next_reconciliation_at = COALESCE(updated_at, created_at)
WHERE status = 'signed';

CREATE INDEX payment_reconciliation_due_idx
  ON payment(status, next_reconciliation_at, reconciliation_lease_until)
  WHERE status = 'signed';
