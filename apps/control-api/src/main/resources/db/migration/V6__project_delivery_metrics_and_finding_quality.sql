ALTER TABLE delivery_rules ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE delivery_logs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_delivery_rules_project_enabled ON delivery_rules(project_id,enabled,created_at DESC);
CREATE INDEX idx_delivery_logs_project_created ON delivery_logs(project_id,created_at DESC);

ALTER TABLE evidence ADD COLUMN uncertainties_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE product_events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL CHECK (event_name IN ('workspace_ready','project_created','source_ready','baseline_completed','finding_reviewed','report_delivered','second_report_delivered')),
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_product_events_owner_created ON product_events(owner_id,created_at DESC);
CREATE INDEX idx_product_events_project_name ON product_events(project_id,event_name,created_at DESC);
