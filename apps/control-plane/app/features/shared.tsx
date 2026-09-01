import type { ReactNode } from 'react';
import { asRecord, text, type JsonRecord } from '../api/v2.js';
import { Link } from '../routes/router.js';
import { EmptyState, ErrorState, LoadingState } from '../components/states.js';

export function value(record: unknown, key: string, fallback = '—'): string {
  const source = asRecord(record);
  const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  return text(source[key] ?? source[snakeKey], fallback);
}

export function list(valueToRead: unknown, ...keys: string[]): JsonRecord[] {
  const source = Array.isArray(valueToRead) ? valueToRead : asRecord(valueToRead);
  if (Array.isArray(source)) return source.filter((item): item is JsonRecord => typeof item === 'object' && item !== null);
  for (const key of keys) {
    const items = source[key];
    if (Array.isArray(items)) return items.filter((item): item is JsonRecord => typeof item === 'object' && item !== null);
  }
  return [];
}

export function pickId(valueToRead: unknown): string {
  const record = asRecord(valueToRead);
  const candidate = record.id ?? record.projectId ?? record.project_id ?? record.reportId ?? record.report_id
    ?? record.workflowId ?? record.workflow_id ?? record.runId ?? record.run_id ?? record.operationId ?? record.operation_id;
  return candidate === undefined || candidate === null ? '' : String(candidate);
}

export function InlineLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="tb-inline-link">{children}</Link>;
}

export function SectionCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="tb-card"><header className="tb-card-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>{children}</section>;
}

export function DataState({ loading, error, retry, empty, children }: { loading: boolean; error: Error | null; retry: () => void; empty: ReactNode; children: ReactNode }) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState error={error} onRetry={retry} />;
  if (children === null || children === undefined) return <>{empty}</>;
  return <>{children}</>;
}

export function CollectionEmpty({ title, description }: { title: string; description: string }) {
  return <EmptyState title={title} description={description} />;
}
