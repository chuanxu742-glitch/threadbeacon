ALTER TABLE skill_runs DROP CONSTRAINT IF EXISTS skill_runs_status_check;
ALTER TABLE skill_runs ADD CONSTRAINT skill_runs_status_check
  CHECK (status IN ('queued','running','awaiting_confirmation','paused','succeeded','failed','cancelled'));
ALTER TABLE skill_runs ADD COLUMN workflow_node_id TEXT;
ALTER TABLE skill_runs ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE skill_runs ADD COLUMN agent_state_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE skill_runs ADD COLUMN confirmation_json TEXT;
ALTER TABLE skill_runs ADD COLUMN lease_owner TEXT REFERENCES nodes(id) ON DELETE SET NULL;
ALTER TABLE skill_runs ADD COLUMN lease_token TEXT;
ALTER TABLE skill_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE skill_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0);
ALTER TABLE skill_runs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20);
ALTER TABLE skill_runs ADD COLUMN max_steps INTEGER NOT NULL DEFAULT 10 CHECK (max_steps BETWEEN 1 AND 50);
ALTER TABLE skill_runs ADD COLUMN allowlist_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE skill_runs ADD COLUMN last_error TEXT;
ALTER TABLE skill_runs ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_skill_runs_claim ON skill_runs(status,lease_expires_at,started_at);
CREATE UNIQUE INDEX idx_skill_runs_workflow_node
  ON skill_runs(workflow_run_id,workflow_node_id)
  WHERE workflow_run_id IS NOT NULL AND workflow_node_id IS NOT NULL;

CREATE TABLE skill_action_reviews (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  action_json TEXT NOT NULL,
  risk_json TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  resolved_by TEXT,
  resolved_at TEXT,
  UNIQUE(run_id,sequence)
);
CREATE UNIQUE INDEX idx_skill_action_reviews_one_pending
  ON skill_action_reviews(run_id) WHERE status='pending';

ALTER TABLE api_tokens ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'
  CHECK (role IN ('owner','editor','viewer'));
ALTER TABLE api_tokens ADD COLUMN scopes_json TEXT NOT NULL DEFAULT '["records:read","runs:read"]';
ALTER TABLE api_tokens ADD COLUMN created_by TEXT;
