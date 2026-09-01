import { useApiQuery } from '../../api/use-api.js';
import { asRecord, objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';

type SettingSection = 'workspace' | 'members' | 'connections' | 'execution' | 'developer' | 'audit';
const tabs: Array<[SettingSection, string]> = [['workspace', '工作区'], ['members', '成员'], ['connections', '连接'], ['execution', '执行资源'], ['developer', '开发者接口'], ['audit', '审计']];

function endpointFor(section: SettingSection): () => Promise<unknown> {
  if (section === 'connections') return v2.connections;
  if (section === 'execution') return v2.executionResources;
  if (section === 'developer') return v2.developer;
  if (section === 'audit') return v2.audit;
  if (section === 'members') return v2.members;
  return v2.context;
}
export function SettingsPage({ section }: { section: SettingSection }) {
  const query = useApiQuery(endpointFor(section), [section]);
  const record = asRecord(query.data);
  const items = list(query.data, 'members', 'connections', 'resources', 'events', 'items');
  const title = tabs.find(item => item[0] === section)?.[1] ?? '工作区';
  return <div className="tb-page tb-settings-page"><PageHeader eyebrow={`SETTINGS / ${section.toUpperCase()}`} title="团队与系统" description="同一应用壳下管理工作区上下文、成员、Connection、Execution Resource、开发者接口和审计。" actions={<Link to="/setup" className="tb-button tb-button-secondary">设置中心</Link>}/><nav className="tb-settings-tabs" aria-label="设置导航">{tabs.map(([id, label]) => <Link key={id} to={`/settings/${id}`} className={section === id ? 'active' : ''}>{label}</Link>)}</nav><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">{section === 'workspace' ? 'WORKSPACE CONTEXT' : section.toUpperCase()}</p><h2>{title}</h2><p>{section === 'members' ? 'viewer 无法修改，editor 不能执行 owner 管理动作。' : section === 'connections' ? '只展示连接引用和策略，secret 保持在安全边界。' : section === 'execution' ? 'Execution Resource 离线会影响项目 Readiness。' : section === 'developer' ? 'PAT 明文只显示一次，MCP 调用需要进入审计。' : section === 'audit' ? '审计记录用于解释写操作、权限和外部副作用。' : '所有操作都解析出明确的 Workspace，上下文切换不复制业务数据。'}</p></div><span className="tb-count-pill">{items.length} 项</span></header><DataState loading={query.loading} error={query.error} retry={query.retry} empty={<EmptyState title={`暂无${title}信息`} description="当前 v2 响应为空，页面不会猜测或生成设置数据。"/>}>{items.length === 0 ? <div className="tb-settings-summary"><div><span>接口状态</span><strong>已返回，但没有可展示条目</strong></div><div><span>workspace</span><strong>{value(record, 'workspaceName', value(asRecord(record.workspace), 'name', '未提供'))}</strong></div><div><span>角色</span><strong>{value(record, 'role', value(record, 'currentRole', '未提供'))}</strong></div></div> : <div className="tb-settings-list">{items.map((item, index) => <article key={objectId(item) || index}><span className="tb-settings-icon">{section === 'audit' ? '≡' : section === 'members' ? '◎' : '◈'}</span><div><strong>{value(item, 'name', value(item, 'email', value(item, 'event', `条目 ${index + 1}`)))}</strong><p>{value(item, 'description', value(item, 'message', value(item, 'role', value(item, 'type', '未提供说明'))))}</p><small>{value(item, 'createdAt', value(item, 'lastCheckedAt', value(item, 'updatedAt', '时间未提供')))}</small></div><StatusBadge value={item.status ?? item.role ?? 'unknown'}/></article>)}</div>}</DataState><JsonDetails value={query.data} label={`查看${title}响应`}/></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">GOVERNANCE BOUNDARY</p><h2>权限与审计</h2><p>Web、MCP 和 Agent 使用同一 Application Service；高风险动作必须经过同样的 scope、revision、审批和审计检查。</p></div></header><div className="tb-contract-note"><span>i</span><p>当前页不提供超出 v2 contract 的写操作，避免在设置中心伪造“已保存”状态。</p></div></section></div>;
}
