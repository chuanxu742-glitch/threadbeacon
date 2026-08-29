CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  capability TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  skill_md TEXT NOT NULL,
  elements_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','deprecated')),
  current_version INTEGER NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  source_trace TEXT,
  distill_model TEXT,
  last_failing_trace_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id,domain,capability)
);
CREATE INDEX idx_skills_owner_updated ON skills(owner_id,updated_at DESC);

CREATE TABLE skill_versions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  skill_md TEXT NOT NULL,
  elements_json TEXT NOT NULL,
  source_trace TEXT,
  distill_model TEXT,
  change_reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(skill_id,version)
);
CREATE INDEX idx_skill_versions_skill_version ON skill_versions(skill_id,version DESC);

CREATE TABLE skill_runs (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  skill_version INTEGER NOT NULL CHECK (skill_version >= 1),
  owner_id TEXT NOT NULL,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','paused','succeeded','failed','cancelled')),
  task_text TEXT NOT NULL,
  trace_json TEXT,
  outcome_json TEXT,
  self_eval_json TEXT,
  proposed_action_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX idx_skill_runs_owner_started ON skill_runs(owner_id,started_at DESC);
CREATE INDEX idx_skill_runs_skill_started ON skill_runs(skill_id,started_at DESC);

CREATE TABLE skill_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  type TEXT NOT NULL CHECK (type IN ('started','perception','proposal','confirmation','action','tool_result','state','done','error')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(run_id,sequence)
);
CREATE INDEX idx_skill_run_events_run_sequence ON skill_run_events(run_id,sequence);

CREATE TABLE skill_evidence (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES skill_runs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('distilled','published','executed','correction_proposed','corrected','correction_dismissed','rolled_back')),
  passed INTEGER CHECK (passed IS NULL OR passed IN (0,1)),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_skill_evidence_skill_created ON skill_evidence(skill_id,created_at);

CREATE TABLE skill_corrections (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','dismissed','rolled_back')),
  from_version INTEGER NOT NULL CHECK (from_version >= 1),
  to_version INTEGER,
  reason TEXT NOT NULL,
  trace_ids_json TEXT NOT NULL DEFAULT '[]',
  candidate_skill_md TEXT,
  candidate_elements_json TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE UNIQUE INDEX idx_skill_corrections_one_open ON skill_corrections(skill_id) WHERE status='proposed';
CREATE INDEX idx_skill_corrections_skill_created ON skill_corrections(skill_id,created_at DESC);
