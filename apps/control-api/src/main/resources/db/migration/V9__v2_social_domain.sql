-- v2 social product domain. Observations remain the immutable content fact source;
-- social objects only store monitor configuration and actionable alert projections.

CREATE TABLE social_monitors (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  monitor_type TEXT NOT NULL
    CHECK (monitor_type IN ('keyword','account','topic')),
  query TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  source_id TEXT REFERENCES project_sources(id) ON DELETE SET NULL,
  interval_minutes INTEGER NOT NULL DEFAULT 60 CHECK (interval_minutes BETWEEN 1 AND 10080),
  status TEXT NOT NULL DEFAULT 'paused'
    CHECK (status IN ('active','paused','error','disabled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  idempotency_key TEXT,
  last_run_at TEXT,
  last_run_observation_id TEXT,
  last_seen_at TEXT,
  last_error TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,name)
);
CREATE INDEX idx_social_monitors_owner_updated
  ON social_monitors(owner_id,updated_at DESC);
CREATE INDEX idx_social_monitors_project_status_updated
  ON social_monitors(project_id,status,updated_at DESC);
CREATE UNIQUE INDEX idx_social_monitors_idempotency
  ON social_monitors(owner_id,project_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE social_alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  monitor_id TEXT REFERENCES social_monitors(id) ON DELETE SET NULL,
  observation_id TEXT REFERENCES observations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 2 CHECK (severity BETWEEN 0 AND 5),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','ignored')),
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  rule_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  dedup_key TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  resolved_by TEXT,
  resolution_reason TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id,dedup_key)
);
CREATE INDEX idx_social_alerts_owner_status_updated
  ON social_alerts(owner_id,status,updated_at DESC);
CREATE INDEX idx_social_alerts_project_status_updated
  ON social_alerts(project_id,status,updated_at DESC);
CREATE INDEX idx_social_alerts_monitor_observation
  ON social_alerts(monitor_id,observation_id,created_at DESC);

-- SocialContent and SocialAccount are read projections over observations/records.
-- Do not introduce a second mutable copy of source facts here.
