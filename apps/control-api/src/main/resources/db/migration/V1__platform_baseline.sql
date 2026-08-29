CREATE TABLE nodes (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL,
  platform TEXT NOT NULL, version TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT '[]',
  runtime_json TEXT NOT NULL DEFAULT '{}', health_json TEXT NOT NULL DEFAULT '{}',
  transport_mode TEXT NOT NULL DEFAULT 'polling', direct_endpoint_encrypted TEXT, direct_token_encrypted TEXT,
  max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 64),
  status TEXT NOT NULL CHECK (status IN ('online','offline')), active_jobs INTEGER NOT NULL DEFAULT 0 CHECK (active_jobs >= 0),
  last_seen_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_nodes_status_seen ON nodes(status,last_seen_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, platform TEXT NOT NULL, keyword TEXT NOT NULL,
  source_options_json TEXT NOT NULL DEFAULT '{}', schedule_id TEXT, scheduled_for TEXT, "limit" INTEGER NOT NULL CHECK ("limit" BETWEEN 1 AND 1000),
  include_comments INTEGER NOT NULL DEFAULT 1 CHECK (include_comments IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100), priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -10 AND 10),
  attempt INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0), max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  assigned_node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL, result_summary TEXT, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE INDEX idx_jobs_owner_created ON jobs(owner_id,created_at DESC);
CREATE INDEX idx_jobs_status_priority_created ON jobs(status,priority DESC,created_at);
CREATE INDEX idx_jobs_node_status ON jobs(assigned_node_id,status);
CREATE UNIQUE INDEX idx_jobs_schedule_occurrence_unique ON jobs(schedule_id,scheduled_for) WHERE schedule_id IS NOT NULL;

CREATE TABLE job_events (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_job_events_job_created ON job_events(job_id,created_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL, item_count INTEGER NOT NULL CHECK (item_count >= 0), pain_point_count INTEGER NOT NULL CHECK (pain_point_count >= 0),
  generated_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_reports_owner_created ON reports(owner_id,created_at DESC);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL, keyword TEXT NOT NULL,
  source_options_json TEXT NOT NULL DEFAULT '{}', "limit" INTEGER NOT NULL CHECK ("limit" BETWEEN 1 AND 1000),
  include_comments INTEGER NOT NULL DEFAULT 1 CHECK (include_comments IN (0,1)), interval_minutes INTEGER NOT NULL CHECK (interval_minutes > 0),
  cron_expression TEXT, timezone TEXT NOT NULL DEFAULT 'UTC', priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), last_run_at TEXT, next_run_at TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_schedules_owner_created ON schedules(owner_id,created_at DESC);
CREATE INDEX idx_schedules_due ON schedules(enabled,next_run_at);

CREATE TABLE records (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, platform TEXT NOT NULL, source_item_id TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'post', title TEXT, content TEXT NOT NULL, author TEXT, url TEXT,
  observed_at TEXT NOT NULL, metrics_json TEXT NOT NULL DEFAULT '{}', raw_json TEXT NOT NULL DEFAULT '{}',
  first_seen_job_id TEXT NOT NULL REFERENCES jobs(id), last_seen_job_id TEXT NOT NULL REFERENCES jobs(id),
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, duplicate_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  UNIQUE(owner_id,platform,source_item_id)
);
CREATE INDEX idx_records_owner_last_seen ON records(owner_id,last_seen_at DESC);
CREATE INDEX idx_records_owner_platform_seen ON records(owner_id,platform,last_seen_at DESC);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE workspace_members (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')), created_at TEXT NOT NULL, UNIQUE(workspace_id,user_id)
);
CREATE TABLE workspace_member_profiles (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  email TEXT NOT NULL, display_name TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(workspace_id,user_id)
);
CREATE TABLE workspace_invitations (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  email TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('editor','viewer')), token_hash TEXT NOT NULL UNIQUE,
  invited_by TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT, accepted_by TEXT, revoked_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_workspace_invitations_workspace_created ON workspace_invitations(workspace_id,created_at DESC);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', template TEXT NOT NULL DEFAULT 'blank', status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_projects_owner_updated ON projects(owner_id,updated_at DESC);
CREATE TABLE project_sources (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  name TEXT NOT NULL, kind TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_project_sources_project_created ON project_sources(project_id,created_at DESC);
CREATE TABLE project_source_cursors (
  source_id TEXT PRIMARY KEY REFERENCES project_sources(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  cursor_json TEXT NOT NULL DEFAULT '{}', last_success_at TEXT, last_job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0), last_error TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX idx_project_source_cursors_owner_updated ON project_source_cursors(owner_id,updated_at DESC);

CREATE TABLE workflows (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', draft_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1), published_version INTEGER NOT NULL DEFAULT 0 CHECK (published_version >= 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_workflows_owner_updated ON workflows(owner_id,updated_at DESC);
CREATE TABLE workflow_versions (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1), spec_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(workflow_id,version)
);
CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES workflow_versions(id), owner_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, result_json TEXT, trigger_json TEXT NOT NULL DEFAULT '{}',
  finalizer_attempt INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at TEXT, last_error TEXT, updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_workflow_runs_owner_started ON workflow_runs(owner_id,started_at DESC);
CREATE TABLE workflow_run_jobs (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
  source_node_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_workflow_run_jobs_run ON workflow_run_jobs(run_id,status);
CREATE TABLE workflow_events (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, node_id TEXT NOT NULL,
  type TEXT NOT NULL, message TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_workflow_events_run_created ON workflow_events(run_id,created_at);
CREATE TABLE workflow_checkpoints (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE, node_id TEXT NOT NULL,
  status TEXT NOT NULL, input_json TEXT NOT NULL DEFAULT '{}', output_json TEXT, started_at TEXT, finished_at TEXT,
  attempt INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', UNIQUE(run_id,node_id)
);
CREATE TABLE workflow_triggers (
  id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  last_triggered_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_workflow_triggers_owner_created ON workflow_triggers(owner_id,created_at DESC);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id), report_id TEXT NOT NULL REFERENCES reports(id), theme TEXT NOT NULL, summary TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 0, source_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_owner_created ON evidence(owner_id,created_at DESC);
CREATE TABLE evidence_links (
  id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE, relation TEXT NOT NULL DEFAULT 'supports', created_at TEXT NOT NULL,
  UNIQUE(evidence_id,record_id)
);
CREATE TABLE record_relationships (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  source_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  target_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  relation TEXT NOT NULL, confidence INTEGER NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100), created_at TEXT NOT NULL,
  UNIQUE(source_record_id,target_record_id,relation)
);
CREATE INDEX idx_record_relationships_owner_created ON record_relationships(owner_id,created_at DESC);

CREATE TABLE delivery_rules (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  endpoint_encrypted TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_delivery_rules_owner_created ON delivery_rules(owner_id,created_at DESC);
CREATE TABLE delivery_logs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, rule_id TEXT NOT NULL REFERENCES delivery_rules(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL, response_code INTEGER, error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_delivery_logs_owner_created ON delivery_logs(owner_id,created_at DESC);
CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, action TEXT NOT NULL, resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_logs_owner_created ON audit_logs(owner_id,created_at DESC);

CREATE TABLE plugin_installations (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, plugin_key TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
  version TEXT NOT NULL, status TEXT NOT NULL, capabilities_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(owner_id,plugin_key)
);
CREATE TABLE browser_profiles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, profile_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'cdp', status TEXT NOT NULL DEFAULT 'configured', profile_kind TEXT NOT NULL DEFAULT 'authenticated',
  node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL, site_bindings_json TEXT NOT NULL DEFAULT '[]', no_vnc_url TEXT, cdp_url TEXT,
  attestation_json TEXT NOT NULL DEFAULT '{}', last_verified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_browser_profiles_owner_created ON browser_profiles(owner_id,created_at DESC);
CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, profile_id TEXT NOT NULL REFERENCES browser_profiles(id),
  node_id TEXT NOT NULL REFERENCES nodes(id), status TEXT NOT NULL, target_id TEXT, tab_ids_json TEXT NOT NULL DEFAULT '[]',
  allowlist_json TEXT NOT NULL, timeout_ms INTEGER NOT NULL, capability TEXT NOT NULL DEFAULT 'cdp', last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX idx_browser_sessions_owner_created ON browser_sessions(owner_id,created_at DESC);
CREATE TABLE browser_actions (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE, owner_id TEXT NOT NULL,
  node_id TEXT NOT NULL REFERENCES nodes(id), type TEXT NOT NULL, status TEXT NOT NULL,
  payload_encrypted TEXT NOT NULL, result_json TEXT, error TEXT, screenshot_key TEXT, timeout_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE INDEX idx_browser_actions_session_created ON browser_actions(session_id,created_at DESC);
CREATE INDEX idx_browser_actions_node_status ON browser_actions(node_id,status,created_at);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
  last_used_at TEXT, expires_at TEXT NOT NULL, revoked_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_api_tokens_owner_created ON api_tokens(owner_id,created_at DESC);
CREATE TABLE compatibility_imports (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, kind TEXT NOT NULL, source_hash TEXT NOT NULL,
  source_json TEXT NOT NULL, report_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_compatibility_imports_owner_created ON compatibility_imports(owner_id,created_at DESC);

CREATE TABLE geo_acquisition_executions (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, request_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL, job_id TEXT UNIQUE REFERENCES jobs(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'accepted', required_artifacts_json TEXT NOT NULL DEFAULT '[]', geo_refs_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT, failure_json TEXT, trace_ref TEXT, artifact_refs_json TEXT NOT NULL DEFAULT '[]', attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT REFERENCES nodes(id) ON DELETE SET NULL, lease_token TEXT, heartbeat_at TEXT, lease_expires_at TEXT,
  cancel_requested_at TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(owner_id,idempotency_key)
);
CREATE INDEX idx_geo_acquisition_status_lease ON geo_acquisition_executions(status,lease_expires_at);
