import { useApiQuery } from '../../api/use-api.js';
import type { ReactNode } from 'react';
import { asRecord, text, v2 } from '../../api/v2.js';
import { ErrorState, LoadingState } from '../../components/states.js';
import { JsonDetails, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { ProjectNav } from '../../shell/ProjectNav.js';
import { value } from '../shared.js';

export function ProjectFrame({ projectId, section, children }: { projectId: string; section: 'overview' | 'social' | 'orchestration' | 'operations' | 'data' | 'delivery' | 'settings'; children: ReactNode }) {
  const project = useApiQuery(() => v2.project(projectId), [projectId]);
  const record = asRecord(project.data);
  const entity = asRecord(record.project ?? project.data);
  const title = value(entity, 'name', value(entity, 'title', projectId));
  if (project.loading) return <div className="tb-page"><LoadingState label="正在打开项目上下文…"/></div>;
  if (project.error) return <div className="tb-page"><ErrorState error={project.error} onRetry={project.retry} title="项目上下文暂时不可用"/></div>;
  return <div className="tb-project-page"><header className="tb-project-header"><div><p className="tb-eyebrow">PROJECT / {projectId.slice(0, 12)}</p><h1>{title}</h1><p>{text(entity.goal ?? entity.description, '持续研究项目')}</p></div><div className="tb-project-header-actions"><StatusBadge value={entity.status ?? entity.readinessStatus ?? 'unknown'}/><Link to="/projects" className="tb-button tb-button-secondary">全部项目</Link></div></header><ProjectNav projectId={projectId} active={section}/>{children}<JsonDetails value={project.data} label="查看项目上下文响应"/></div>;
}
