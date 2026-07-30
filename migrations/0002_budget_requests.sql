CREATE TABLE budget_request (
  id TEXT PRIMARY KEY,
  owner_issuer TEXT NOT NULL,
  owner_subject TEXT NOT NULL,
  agent_issuer TEXT NOT NULL,
  agent_subject TEXT NOT NULL,
  requested_name TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  approval_token_hash TEXT NOT NULL UNIQUE,
  grant_id TEXT REFERENCES agent_grant(id),
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX budget_request_agent_idx
  ON budget_request(owner_issuer, owner_subject, agent_issuer, agent_subject, created_at DESC);
