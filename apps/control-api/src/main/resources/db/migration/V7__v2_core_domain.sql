-- v2 core domain expansion.  Existing tables remain the compatibility storage
-- for the worker protocol; v2 owns the lifecycle fields added here.

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('configured','verified','degraded','disabled')),
  config_json TEXT NOT NULL DEFAULT '{}',
  secret_ref TEXT,
  last_verified_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id,name)
);
CREATE INDEX idx_connections_owner_updated ON connections(owner_id,updated_at DESC);

CREATE TABLE execution_resources (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'worker',
  status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('ready','offline','degraded','unknown')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id,name)
);
CREATE INDEX idx_execution_resources_workspace_status
  ON execution_resources(workspace_id,status,updated_at DESC);

ALTER TABLE projects ADD COLUMN archived_at TEXT;
ALTER TABLE projects ADD COLUMN primary_workflow_id TEXT;
ALTER TABLE projects ADD COLUMN objective TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
CREATE INDEX idx_projects_workspace_status_updated
  ON projects(workspace_id,status,updated_at DESC);

ALTER TABLE project_sources ADD COLUMN connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL;
ALTER TABLE project_sources ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE project_sources ADD COLUMN health_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE project_sources ADD COLUMN last_probed_at TEXT;
ALTER TABLE project_sources ADD COLUMN archived_at TEXT;
CREATE INDEX idx_project_sources_project_status
  ON project_sources(project_id,status,updated_at DESC);

ALTER TABLE workflows ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft','validating','valid','blocked','published'));
ALTER TABLE workflows ADD COLUMN last_validation_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX idx_workflows_project_status_updated
  ON workflows(project_id,status,updated_at DESC);

ALTER TABLE workflow_versions ADD COLUMN spec_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE workflow_versions ADD COLUMN source_snapshot_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workflow_versions ADD COLUMN published_at TEXT;
UPDATE workflow_versions SET spec_hash=md5(spec_json) WHERE spec_hash='';
CREATE INDEX idx_workflow_versions_workflow_created
  ON workflow_versions(workflow_id,created_at DESC);

CREATE OR REPLACE FUNCTION threadbeacon_reject_workflow_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workflow versions are immutable' USING ERRCODE = '55006';
END;
$$;
DROP TRIGGER IF EXISTS workflow_versions_immutable ON workflow_versions;
CREATE TRIGGER workflow_versions_immutable
  BEFORE UPDATE OR DELETE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION threadbeacon_reject_workflow_version_mutation();

ALTER TABLE workflow_runs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE workflow_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE workflow_runs ADD COLUMN readiness_json TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX idx_workflow_runs_idempotency
  ON workflow_runs(owner_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_workflow_runs_project_started
  ON workflow_runs(owner_id,started_at DESC);

ALTER TABLE workflow_events ADD COLUMN sequence BIGINT;
CREATE INDEX idx_workflow_events_run_sequence
  ON workflow_events(run_id,sequence,created_at);

-- The database cannot infer a workspace for legacy rows.  v2 services only
-- expose project-owned resources and preserve the legacy owner_id boundary.
