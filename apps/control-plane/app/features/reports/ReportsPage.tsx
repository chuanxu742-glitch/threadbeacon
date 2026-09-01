import { useApiQuery } from '../../api/use-api.js';
import { objectId, v2, type JsonRecord } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';

export function ReportsPage() {
  const reports = useApiQuery(async () => {
    const projectResponse = await v2.projects();
    const projects = list(projectResponse, 'projects', 'items').slice(0, 50);
    const projectReports = await Promise.all(projects.map(async project => {
      const projectId = objectId(project);
      if (!projectId) return [] as JsonRecord[];
      const response = await v2.reports(projectId);
      return list(response, 'reports', 'versions', 'items').map(report => ({
        ...report,
        projectId: report.projectId ?? projectId,
        projectName: report.projectName ?? value(project, 'name', '未命名项目'),
      }));
    }));
    return { reports: projectReports.flat(), projectCount: projects.length };
  }, []);
  const items = list(reports.data, 'reports');
  return <div className="tb-page"><PageHeader eyebrow="REPORTS / IMMUTABLE VERSIONS" title="报告" description="面向受众的不可变 Report Version；正式 Finding、证据关系和交付结果都保留版本血缘。" actions={<Link to="/projects" className="tb-button tb-button-secondary">从项目查看报告</Link>}/><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">REPORT INDEX</p><h2>团队报告版本</h2><p>报告索引由项目列表和各项目的 `/api/v2/projects/:id/reports` 聚合；不会猜测未公开的全局报告。</p></div><span className="tb-count-pill">{items.length} 份</span></header><DataState loading={reports.loading} error={reports.error} retry={reports.retry} empty={<EmptyState title="暂无报告版本" description="正式报告会在项目运行、Finding 复核和报告发布完成后进入这里。"/>}>{items.length === 0 ? <EmptyState title="暂无报告版本" description="v2 返回空列表，尚未有可阅读的正式报告。" action={<Link to="/projects" className="tb-button tb-button-primary">打开项目</Link>}/> : <div className="tb-report-table">{items.map((report, index) => {const id = objectId(report); return <article key={id || index}><div className="tb-report-icon">▤</div><div><strong>{value(report, 'title', value(report, 'name', `Report Version ${index + 1}`))}</strong><p>{value(report, 'projectName', value(report, 'projectId', '项目上下文未提供'))}</p><small>{value(report, 'publishedAt', value(report, 'createdAt', '时间未提供'))}</small></div><StatusBadge value={report.status ?? 'unknown'}/>{id ? <Link to={`/reports/${encodeURIComponent(id)}`} className="tb-card-link">阅读报告 <span>→</span></Link> : <span className="tb-muted">缺少报告 ID</span>}</article>})}</div>}</DataState><JsonDetails value={reports.data} label="查看报告索引响应"/></section></div>;
}
