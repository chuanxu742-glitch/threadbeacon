'use client';

import { useState, type FormEvent } from 'react';
import { formatDate, platforms, type Project, type ProjectSource, type Template } from './types.js';

export function ProjectsView({
  projects,
  templates,
  sources,
  workflowsCount,
  selectedProject,
  busy,
  onSelectProject,
  onCreateProject,
  onCreateSource,
  onTestSource,
  onCreateWorkflow,
}: {
  projects: Project[];
  templates: Template[];
  sources: ProjectSource[];
  workflowsCount: (projectId: string) => number;
  selectedProject: string;
  busy: boolean;
  onSelectProject: (id: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  onCreateSource: (event: FormEvent<HTMLFormElement>, kind: string) => void;
  onTestSource: (sourceId: string) => void;
  onCreateWorkflow: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [sourceKind, setSourceKind] = useState('opencli');
  const project = projects.find((item) => item.id === selectedProject) ?? null;
  const projectSources = sources.filter((item) => item.project_id === selectedProject);

  return (
    <div className="product-page">
      <section className="project-hero">
        <div>
          <p className="eyebrow">PROJECT HOME</p>
          <h2>从研究目标开始，持续产出可追溯结果</h2>
          <p>来源、编排、运行、证据和交付都在同一个项目上下文中协同推进。</p>
        </div>
        <form onSubmit={onCreateProject}>
          <input name="name" required placeholder="新项目名称" />
          <input name="description" placeholder="研究目标与调研范围" />
          <select name="template">
            {templates.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button disabled={busy}>创建项目</button>
        </form>
      </section>

      <div className="project-layout">
        <section>
          <div className="section-title">
            <div>
              <h3>研究项目</h3>
              <p>选择项目后配置来源和研究流程</p>
            </div>
            <span>{projects.length} 个项目</span>
          </div>
          <div className="project-grid">
            {projects.map((item) => (
              <button
                key={item.id}
                className={selectedProject === item.id ? 'selected' : ''}
                onClick={() => onSelectProject(item.id)}
              >
                <span className="project-symbol">{item.name.slice(0, 1)}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>{item.description || '未填写研究说明'}</small>
                  <em>
                    {sources.filter((source) => source.project_id === item.id).length} 来源 ·{' '}
                    {workflowsCount(item.id)} 流程
                  </em>
                </div>
              </button>
            ))}
            {!projects.length && <div className="studio-empty">创建第一个研究项目开始。</div>}
          </div>
        </section>

        <aside className="project-inspector">
          <div className="section-title">
            <div>
              <h3>{project?.name ?? '项目配置'}</h3>
              <p>来源连接与研究流程入口</p>
            </div>
          </div>
          {project && (
            <>
              <form
                className="compact-form"
                onSubmit={(event) => onCreateSource(event, sourceKind)}
              >
                <input name="name" required placeholder="数据源名称" />
                <select
                  name="kind"
                  value={sourceKind}
                  onChange={(event) => setSourceKind(event.target.value)}
                >
                  <option value="opencli">OpenCLI 平台</option>
                  <option value="native">原生 API</option>
                  <option value="rss">RSS / Atom</option>
                  <option value="rest">REST API</option>
                  <option value="web">公开网页</option>
                </select>
                <input
                  name="endpoint"
                  required
                  placeholder={
                    sourceKind === 'opencli'
                      ? '站点名，如 hackernews / zhihu'
                      : 'https:// 数据源地址'
                  }
                />
                {sourceKind === 'opencli' ? (
                  <>
                    <input name="command" placeholder="只读命令（可选，未填则自动发现）" />
                    <textarea
                      name="args"
                      rows={3}
                      placeholder={'命令参数：JSON 数组或每行一项\n--limit\n20'}
                    />
                    <small>OpenCLI 任意站点均可登记；特殊站点可显式指定只读命令与参数。</small>
                  </>
                ) : (
                  <>
                    <input name="defaultKeyword" placeholder="默认关键词（可选）" />
                    <input name="itemsPath" placeholder="REST 数组路径，如 data.items（可选）" />
                    <div className="source-secret-row">
                      <input name="secretHeader" placeholder="密钥头，如 x-api-key" />
                      <input name="secretEnv" placeholder="Worker 环境变量名" />
                    </div>
                    <small>密钥只引用 Worker 环境变量，值不会写入数据库。</small>
                  </>
                )}
                <button disabled={busy}>登记来源</button>
              </form>

              <div className="source-stack">
                {projectSources.map((source) => (
                  <article key={source.id}>
                    <i>{source.kind === 'opencli' ? '⌘' : '◎'}</i>
                    <div>
                      <strong>{source.name}</strong>
                      <small>
                        {source.kind} · {source.status}
                        {source.last_success_at
                          ? ` · 最近成功 ${formatDate(source.last_success_at)}`
                          : ''}
                        {source.consecutive_failures
                          ? ` · 连续失败 ${source.consecutive_failures}`
                          : ''}
                      </small>
                      {source.cursor_json && <code title={source.cursor_json}>增量游标已保存</code>}
                      {source.last_error && <em title={source.last_error}>{source.last_error}</em>}
                    </div>
                    <button
                      type="button"
                      disabled={busy || source.status === 'testing'}
                      onClick={() => void onTestSource(source.id)}
                    >
                      {source.status === 'testing' ? '测试中' : '试运行'}
                    </button>
                  </article>
                ))}
              </div>

              <form className="compact-form workflow-create" onSubmit={onCreateWorkflow}>
                <h4>创建可运行研究流程</h4>
                <input name="name" required placeholder="流程名称" />
                <input name="description" placeholder="用途说明" />
                <select
                  name="sourceBinding"
                  defaultValue={
                    projectSources[0]
                      ? `source:${projectSources[0].id}`
                      : 'platform:opencli:hackernews'
                  }
                >
                  {projectSources.length > 0 && (
                    <optgroup label="项目数据源">
                      {projectSources.map((source) => (
                        <option value={`source:${source.id}`} key={source.id}>
                          {source.name} · {source.kind}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="直接选择平台">
                    {Object.entries(platforms)
                      .filter(([id]) => !['rss', 'rest', 'web'].includes(id))
                      .map(([id, name]) => (
                        <option value={`platform:${id}`} key={id}>
                          {name}
                        </option>
                      ))}
                  </optgroup>
                </select>
                <input name="keyword" required placeholder="采集关键词" />
                <input name="limit" type="number" min="1" max="1000" defaultValue="100" />
                <button disabled={busy}>创建并打开画布</button>
              </form>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
