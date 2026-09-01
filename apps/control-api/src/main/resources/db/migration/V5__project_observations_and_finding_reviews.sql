ALTER TABLE jobs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE jobs ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL;
CREATE INDEX idx_jobs_project_created ON jobs(project_id,created_at DESC);
CREATE INDEX idx_jobs_workflow_run ON jobs(workflow_run_id);

ALTER TABLE reports ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN method_key TEXT NOT NULL DEFAULT 'generic-research';
ALTER TABLE reports ADD COLUMN method_version TEXT NOT NULL DEFAULT '1.0';
ALTER TABLE reports ADD COLUMN observation_count INTEGER NOT NULL DEFAULT 0 CHECK (observation_count >= 0);
ALTER TABLE reports ADD COLUMN baseline_count INTEGER NOT NULL DEFAULT 0 CHECK (baseline_count >= 0);
ALTER TABLE reports ADD COLUMN new_count INTEGER NOT NULL DEFAULT 0 CHECK (new_count >= 0);
ALTER TABLE reports ADD COLUMN changed_count INTEGER NOT NULL DEFAULT 0 CHECK (changed_count >= 0);
ALTER TABLE reports ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0 CHECK (unchanged_count >= 0);
CREATE INDEX idx_reports_project_created ON reports(project_id,created_at DESC);

ALTER TABLE projects ADD COLUMN playbook_key TEXT NOT NULL DEFAULT 'generic-research';
ALTER TABLE projects ADD COLUMN playbook_version TEXT NOT NULL DEFAULT '1.0';

ALTER TABLE evidence ADD COLUMN workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL;
ALTER TABLE evidence ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (review_status IN ('pending','approved','rejected'));
ALTER TABLE evidence ADD COLUMN reviewed_by TEXT;
ALTER TABLE evidence ADD COLUMN reviewed_at TEXT;
ALTER TABLE evidence ADD COLUMN review_rationale TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_evidence_project_status ON evidence(project_id,review_status,created_at DESC);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('baseline','new','changed','unchanged')),
  observed_at TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  source_url TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(job_id,record_id)
);
CREATE INDEX idx_observations_project_created ON observations(project_id,created_at DESC);
CREATE INDEX idx_observations_record_created ON observations(record_id,created_at DESC);
CREATE INDEX idx_observations_source_hash ON observations(owner_id,platform,source_item_id,content_hash);

CREATE TABLE finding_reviews (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve','edit','reject')),
  reviewer_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 5),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_finding_reviews_evidence_created ON finding_reviews(evidence_id,created_at DESC);
