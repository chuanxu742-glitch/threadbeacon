ALTER TABLE delivery_logs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 3);

CREATE INDEX idx_delivery_logs_rule_job_attempt
  ON delivery_logs(rule_id, job_id, attempt);
