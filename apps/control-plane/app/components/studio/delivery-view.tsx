'use client';

import { type FormEvent } from 'react';
import { formatDate, type Audit, type Project, type Rule } from './types.js';

export function DeliveryView({
  rules,
  auditLogs,
  projects,
  selectedProject,
  busy,
  onCreateRule,
  onToggleRule,
}: {
  rules: Rule[];
  auditLogs: Audit[];
  projects: Project[];
  selectedProject: string;
  busy: boolean;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onToggleRule: (id: string) => void;
}) {
  return (
    <div className="product-page">
      <div className="governance-layout">
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>自动交付规则</h3>
              <p>端点凭据加密保存，任务成功产出后自动投递至指定通讯渠道</p>
            </div>
          </div>
          <form className="delivery-form" onSubmit={onCreateRule}>
            <input name="name" required placeholder="规则名称" />
            <select name="projectId" defaultValue={selectedProject} aria-label="项目">
              <option value="">所有项目</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <select name="kind">
              <option value="webhook">Webhook</option>
              <option value="feishu">飞书</option>
              <option value="dingtalk">钉钉</option>
              <option value="wecom">企业微信</option>
              <option value="email">Email HTTPS Gateway</option>
            </select>
            <input name="endpoint" type="url" required placeholder="https://..." />
            <button disabled={busy}>添加交付规则</button>
          </form>
          <div className="rule-list">
            {rules.map((rule) => (
              <button key={rule.id} onClick={() => void onToggleRule(rule.id)}>
                <span>
                  <strong>{rule.name}</strong>
                  <small>{rule.kind} · {rule.project_id ? projects.find((project) => project.id === rule.project_id)?.name ?? '项目规则' : '所有项目'}</small>
                </span>
                <b>{rule.enabled ? '已启用' : '已暂停'}</b>
              </button>
            ))}
            {!rules.length && <div className="studio-empty">尚未添加交付规则。</div>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>审计日志</h3>
              <p>追溯项目、研究流程、任务执行与资源分配的变更履历</p>
            </div>
          </div>
          <div className="audit-list">
            {auditLogs.map((item) => (
              <article key={item.id}>
                <code>{item.action}</code>
                <span>
                  {item.resource_type}
                  <small>{formatDate(item.created_at)}</small>
                </span>
              </article>
            ))}
            {!auditLogs.length && <div className="studio-empty">暂无审计日志记录。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
