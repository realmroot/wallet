ALTER TABLE wallet_user ADD COLUMN paused_at TEXT;

ALTER TABLE agent_grant ADD COLUMN allowed_origins TEXT NOT NULL DEFAULT '[]';
ALTER TABLE agent_grant ADD COLUMN allowed_recipients TEXT NOT NULL DEFAULT '[]';
