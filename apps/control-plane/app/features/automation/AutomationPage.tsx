import { useApiQuery } from '../../api/use-api.js';
import { objectId, v2 } from '../../api/v2.js';
import { EmptyState } from '../../components/states.js';
import { JsonDetails, PageHeader, StatusBadge } from '../../components/ui.js';
import { Link } from '../../routes/router.js';
import { DataState, list, value } from '../shared.js';

export function AutomationPage() {
  const automations = useApiQuery(v2.automations, []);
  const items = list(automations.data, 'automations', 'playbooks', 'skills', 'items');
  return <div className="tb-page"><PageHeader eyebrow="AUTOMATION / VERSIONED METHODS" title="自动化" description="重复运行的研究方法绑定确切 Workflow Version；高风险 Skill 动作进入待处理中心等待确认。" actions={<Link to="/projects" className="tb-button tb-button-primary">从项目创建方法 →</Link>}/><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">AUTOMATION CATALOG</p><h2>自动化方法</h2><p>页面只消费 v2 资源，不将 Worker、DAG 或内部协议当作普通研究入口。</p></div><span className="tb-count-pill">{items.length} 个</span></header><DataState loading={automations.loading} error={automations.error} retry={automations.retry} empty={<EmptyState title="暂无自动化方法" description="发布项目流程版本后，可以在此绑定计划、Playbook 或 Skill。" action={<Link to="/projects" className="tb-button tb-button-primary">浏览项目</Link>}/>}>{items.length === 0 ? <EmptyState title="暂无自动化方法" description="v2 返回空列表，当前工作区还没有可重复运行的方法。"/> : <div className="tb-automation-list">{items.map((item, index) => {const id = objectId(item); return <article key={id || index}><span className="tb-automation-icon">◇</span><div><strong>{value(item, 'name', value(item, 'title', `自动化 ${index + 1}`))}</strong><p>{value(item, 'description', value(item, 'workflowVersionId', '版本绑定未提供'))}</p><small>{value(item, 'trigger', value(item, 'schedule', '触发方式未提供'))}</small></div><StatusBadge value={item.status ?? 'unknown'}/></article>})}</div>}</DataState><JsonDetails value={automations.data} label="查看自动化响应"/></section><section className="tb-card"><header className="tb-card-header"><div><p className="tb-eyebrow">GOVERNANCE</p><h2>自动化边界</h2><p>计划、Skill、Webhook、Dify 和 MCP 应复用同一权限、revision、审批与审计边界。</p></div></header><div className="tb-contract-note"><span>i</span><p>此处提供发布流程、现有计划与 Skill 的安全只读投影；变更仍在各自领域入口执行并写入统一审计。</p></div></section></div>;
}
