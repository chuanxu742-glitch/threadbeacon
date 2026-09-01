import type { ReactNode } from 'react';
import { V2ApiError } from '../api/v2.js';

export function LoadingState({ label = '正在加载 v2 数据…' }: { label?: string }) {
  return <div className="tb-state tb-loading" role="status"><span className="tb-spinner" aria-hidden="true"/><p>{label}</p></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="tb-state tb-empty"><span className="tb-empty-mark" aria-hidden="true">∅</span><div><h3>{title}</h3><p>{description}</p>{action && <div className="tb-state-action">{action}</div>}</div></div>;
}

export function ErrorState({ error, onRetry, title = 'v2 数据暂时不可用' }: { error: Error; onRetry?: () => void; title?: string }) {
  const apiError = error instanceof V2ApiError ? error : null;
  return <div className="tb-state tb-error" role="alert"><span className="tb-error-mark" aria-hidden="true">!</span><div><h3>{title}</h3><p>{error.message}</p><small>{apiError && `错误码 ${apiError.code}${apiError.correlationId ? ` · 关联 ID ${apiError.correlationId}` : ''}`}</small>{onRetry && <button type="button" className="tb-button tb-button-secondary" onClick={onRetry}>重试</button>}</div></div>;
}
