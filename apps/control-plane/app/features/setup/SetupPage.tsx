import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';

function ReadinessCard({ title, description, query }: { title: string; description: string; query: ReturnType<typeof useApiQuery<unknown>> }) {
  const items = list(query.data, 'checks', 'capabilities', 'resources', 'executionResources', 'connections', 'items');
  return <section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">READINESS</p><h2>{title}</h2><p>{description}</p></div><span className="tb-count-pill">{items.length} 项</span></header><DataState loading={query.loading} error={query.error} retry={query.retry} empty={<EmptyState title={`暂无${title}`} description="v2 尚未返回可展示的就绪度投影。"/>}>{items.length === 0 ? <EmptyState title={`暂无${title}`} description="当前响应为空，无法推断资源状态。"/> : <div className="tb-readiness-list">{items.map((item, index) => <article key={objectId(item) || index}><span className="tb-readiness-icon">{value(item, 'status', 'unknown') === 'ready' ? '✓' : '!'}</span><div><strong>{value(item, 'name', value(item, 'message', `检查 ${index + 1}`))}</strong><p>{value(item, 'message', value(item, 'description', '未提供说明'))}</p><small>{value(item, 'code', '未提供 code')} · {value(item, 'affectedObject', '共享能力')}</small></div><StatusBadge value={item.status ?? 'unknown'}/>{typeof item.remediationRoute === 'string' && item.remediationRoute.startsWith('/') && <Link to={item.remediationRoute}>修复 →</Link>}</article>)}</div>}</DataState><JsonDetails value={query.data} label={`查看${title}响应`}/></section>;
}

export function SetupPage() {
  const readiness = useApiQuery(v2.capabilitiesReadiness, []);
  const resources = useApiQuery(v2.executionResources, []);
  const connections = useApiQuery(v2.connections, []);
  return <div className="tb-page"><PageHeader eyebrow="SETUP CENTER / REAL READINESS" title="设置中心" description="查看共享能力、连接和执行资源的真实就绪度；目录存在不等于项目可以运行。" actions={<Link to="/settings/workspace" className="tb-button tb-button-secondary">进入团队设置 →</Link>}/><div className="tb-setup-grid"><ReadinessCard title="能力就绪度" description="平台能力需要结合 Worker、key、Profile 和验收状态。" query={readiness}/><ReadinessCard title="执行资源" description="只展示资源健康摘要，不展示 Worker 内部协议。" query={resources}/><ReadinessCard title="工作区连接" description="Connection 仅保存授权引用和策略，secret 不在页面明文展示。" query={connections}/></div><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">REMEDIATION CONTRACT</p><h2>每个阻塞项都应可解释</h2><p>非 ready 状态需要稳定 code、用户语言、affectedObject、remediationRoute、lastCheckedAt 和 evidence。</p></div></header><div className="tb-contract-note"><span>✓</span><p>如果接口暂未实现，页面保留真实错误码和关联 ID，不以本地占位状态替代服务端事实。</p></div><JsonDetails value={{ readiness: asRecord(readiness.data), resources: asRecord(resources.data), connections: asRecord(connections.data) }} label="查看设置中心响应"/></section></div>;
}
