-- v2 research assets, immutable report versions, delivery operations and attention projection.

ALTER TABLE finding_reviews ADD COLUMN IF NOT EXISTS revision INTEGER;
WITH ranked AS (
  -- Revision 1 is the immutable seed projection; historical reviews start at 2.
  SELECT id, ROW_NUMBER() OVER (PARTITION BY evidence_id ORDER BY created_at, id) + 1 AS revision
  FROM finding_reviews
)
UPDATE finding_reviews r SET revision = ranked.revision
FROM ranked WHERE r.id = ranked.id AND r.revision IS NULL;
UPDATE finding_reviews SET revision = 1 WHERE revision IS NULL;
ALTER TABLE finding_reviews ALTER COLUMN revision SET NOT NULL;
ALTER TABLE finding_reviews DROP CONSTRAINT IF EXISTS finding_reviews_revision_check;
ALTER TABLE finding_reviews ADD CONSTRAINT finding_reviews_revision_check CHECK (revision >= 1);
CREATE UNIQUE INDEX IF NOT EXISTS idx_finding_reviews_evidence_revision ON finding_reviews(evidence_id, revision);

CREATE TABLE finding_revisions (
  id TEXT PRIMARY KEY,
  finding_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  action TEXT NOT NULL CHECK (action IN ('initial','approve','edit','reject')),
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  reviewer_id TEXT NOT NULL,
  theme TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 5),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(finding_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_finding_revisions_finding_created
  ON finding_revisions(finding_id, revision DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finding_revisions_owner_status
  ON finding_revisions(owner_id, status, created_at DESC);

ALTER TABLE finding_reviews ADD COLUMN IF NOT EXISTS finding_revision_id TEXT;
ALTER TABLE finding_reviews DROP CONSTRAINT IF EXISTS finding_reviews_revision_fk;
ALTER TABLE finding_reviews ADD CONSTRAINT finding_reviews_revision_fk
  FOREIGN KEY (finding_revision_id) REFERENCES finding_revisions(id) ON DELETE SET NULL;

-- Seed a revision for findings written by the pre-v2 worker path. Later reviews are appended.
INSERT INTO finding_revisions
  (id, finding_id, owner_id, revision, action, status, reviewer_id, theme, summary, severity, rationale, created_at)
SELECT md5('initial|' || e.id), e.id, e.owner_id, 1, 'initial', e.review_status,
       COALESCE(e.reviewed_by, e.owner_id), e.theme, e.summary,
       GREATEST(0, LEAST(5, e.severity)), e.review_rationale, e.created_at
FROM evidence e
WHERE NOT EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.finding_id = e.id);

INSERT INTO finding_revisions
  (id, finding_id, owner_id, revision, action, status, reviewer_id, theme, summary, severity, rationale, created_at)
SELECT md5('review|' || r.id), r.evidence_id, r.owner_id, r.revision, r.action,
       CASE r.action WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'pending' END,
       r.reviewer_id, r.theme, r.summary, GREATEST(0, LEAST(5, r.severity)), r.rationale, r.created_at
FROM finding_reviews r
WHERE NOT EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.id = md5('review|' || r.id));
UPDATE finding_reviews r
SET finding_revision_id = md5('review|' || r.id)
WHERE EXISTS (SELECT 1 FROM finding_revisions fr WHERE fr.id = md5('review|' || r.id));

CREATE TABLE report_drafts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  base_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_version_id TEXT REFERENCES workflow_versions(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  selected_finding_ids_json TEXT NOT NULL DEFAULT '[]',
  method_key TEXT NOT NULL DEFAULT 'generic-research',
  method_version TEXT NOT NULL DEFAULT '1.0',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','abandoned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_report_drafts_project_updated
  ON report_drafts(project_id, updated_at DESC);

CREATE TABLE report_versions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_draft_id TEXT NOT NULL REFERENCES report_drafts(id) ON DELETE RESTRICT,
  workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
  workflow_version_id TEXT REFERENCES workflow_versions(id) ON DELETE SET NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  method_key TEXT NOT NULL DEFAULT 'generic-research',
  method_version TEXT NOT NULL DEFAULT '1.0',
  evidence_complete INTEGER NOT NULL DEFAULT 0 CHECK (evidence_complete IN (0,1)),
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_report_versions_owner_created
  ON report_versions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_report_versions_project_version
  ON report_versions(project_id, version DESC);

CREATE TABLE report_version_findings (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL REFERENCES report_versions(id) ON DELETE RESTRICT,
  finding_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE RESTRICT,
  finding_revision_id TEXT NOT NULL REFERENCES finding_revisions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  theme TEXT NOT NULL,
  summary TEXT NOT NULL,
  severity INTEGER NOT NULL CHECK (severity BETWEEN 0 AND 5),
  rationale TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(report_version_id, finding_id),
  UNIQUE(report_version_id, position)
);
CREATE INDEX IF NOT EXISTS idx_report_version_findings_version
  ON report_version_findings(report_version_id, position);

CREATE TABLE delivery_operations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_version_id TEXT NOT NULL REFERENCES report_versions(id) ON DELETE RESTRICT,
  rule_id TEXT NOT NULL REFERENCES delivery_rules(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  destination_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','submitted','succeeded','failed','unknown','cancelled')),
  technical_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (technical_status IN ('pending','submitted','failed','unknown')),
  business_outcome_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (business_outcome_status IN ('pending','confirmed','failed','unknown')),
  business_outcome_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_delivery_operations_project_created
  ON delivery_operations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_operations_attention
  ON delivery_operations(owner_id, status, updated_at DESC);

CREATE TABLE delivery_attempts (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES delivery_operations(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','submitted','succeeded','failed','unknown')),
  execution_result_json TEXT NOT NULL DEFAULT '{}',
  response_code INTEGER,
  external_id TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(operation_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_operation_attempt
  ON delivery_attempts(operation_id, attempt DESC);

CREATE TABLE attention_items (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  severity INTEGER NOT NULL DEFAULT 0 CHECK (severity BETWEEN 0 AND 5),
  remediation_route TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
  resolved_by TEXT,
  resolution_reason TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_attention_owner_status_updated
  ON attention_items(owner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_attention_project_status_updated
  ON attention_items(project_id, status, updated_at DESC);

-- The API has no mutation path for these objects; the database also rejects accidental rewrites.
CREATE OR REPLACE FUNCTION threadbeacon_reject_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'observations are immutable' USING ERRCODE = '55006';
END;
$$;
DROP TRIGGER IF EXISTS observations_immutable ON observations;
CREATE TRIGGER observations_immutable
  BEFORE UPDATE OR DELETE ON observations
  FOR EACH ROW EXECUTE FUNCTION threadbeacon_reject_observation_mutation();

CREATE OR REPLACE FUNCTION threadbeacon_reject_report_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'report versions are immutable' USING ERRCODE = '55006';
END;
$$;
DROP TRIGGER IF EXISTS report_versions_immutable ON report_versions;
CREATE TRIGGER report_versions_immutable
  BEFORE UPDATE OR DELETE ON report_versions
  FOR EACH ROW EXECUTE FUNCTION threadbeacon_reject_report_version_mutation();
DROP TRIGGER IF EXISTS report_version_findings_immutable ON report_version_findings;
CREATE TRIGGER report_version_findings_immutable
  BEFORE UPDATE OR DELETE ON report_version_findings
  FOR EACH ROW EXECUTE FUNCTION threadbeacon_reject_report_version_mutation();
