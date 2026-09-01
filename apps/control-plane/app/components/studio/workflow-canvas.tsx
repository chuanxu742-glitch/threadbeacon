'use client';

import { type DragEvent } from 'react';
import {
  nodeMeta,
  platforms,
  safeJson,
  type NodeType,
  type ProjectSource,
  type SkillOption,
  type Workflow,
  type WorkflowNode,
  type WorkflowSpec,
} from './types.js';

export function sourceFromNode(node: WorkflowNode) {
  const projectSourceId =
    typeof node.config['projectSourceId'] === 'string'
      ? node.config['projectSourceId']
      : undefined;
  return {
    platform: String(node.config['platform'] ?? 'bluesky'),
    keyword: String(node.config['keyword'] ?? ''),
    limit: Number(node.config['limit'] ?? 100),
    includeComments: node.config['includeComments'] !== false,
    ...(projectSourceId ? { projectSourceId } : {}),
  };
}

export function layoutNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const sources = nodes.filter((node) => node.type === 'source');
  const processing = nodes.filter((node) => node.type !== 'source');
  return [
    ...sources.map((node, index) => ({
      ...node,
      x: Number.isFinite(node.x) && node.x > 0 ? node.x : 45,
      y: Number.isFinite(node.y) && node.y > 0 ? node.y : 35 + index * 135,
      label: node.label || `采集来源 ${index + 1}`,
    })),
    ...processing.map((node, index) => ({
      ...node,
      x: Number.isFinite(node.x) && node.x > 0 ? node.x : 260 + index * 190,
      y: Number.isFinite(node.y) && node.y > 0 ? node.y : 105,
    })),
  ];
}

export function specWith(nodes: WorkflowNode[], edges: WorkflowSpec['edges']): WorkflowSpec {
  const positioned = layoutNodes(nodes);
  const sources = positioned.filter((node) => node.type === 'source').map(sourceFromNode);
  const source = sources[0] ?? {
    platform: 'bluesky',
    keyword: '',
    limit: 100,
    includeComments: true,
  };
  return {
    source,
    sources,
    steps: positioned.filter((node) => node.type !== 'source').map((node) => node.type),
    nodes: positioned,
    edges,
  };
}

export function reaches(spec: WorkflowSpec, start: string, target: string): boolean {
  const queue = [start];
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const edge of spec.edges) {
      if (edge.source === current) queue.push(edge.target);
    }
  }
  return false;
}

export function WorkflowCanvas({
  workflow,
  spec,
  projectWorkflows,
  projectSources,
  skills,
  platformCatalog,
  selectedWorkflow,
  selectedNode,
  dragged,
  busy,
  onSelectWorkflow,
  onSelectNode,
  onSetDragged,
  onWorkflowAction,
  onAddNode,
  onRemoveNode,
  onDropNode,
  onUpdateNode,
  onUpdateNodeConfig,
  onToggleUpstream,
}: {
  workflow: Workflow | null;
  spec: WorkflowSpec | null;
  projectWorkflows: Workflow[];
  projectSources: ProjectSource[];
  skills: SkillOption[];
  platformCatalog: string[];
  selectedWorkflow: string;
  selectedNode: string;
  dragged: string;
  busy: boolean;
  onSelectWorkflow: (id: string) => void;
  onSelectNode: (id: string) => void;
  onSetDragged: (id: string) => void;
  onWorkflowAction: (action: 'save' | 'publish' | 'run') => void;
  onAddNode: (type: NodeType) => void;
  onRemoveNode: (id: string) => void;
  onDropNode: (target: string, event: DragEvent<HTMLDivElement>) => void;
  onUpdateNode: (key: string, value: unknown) => void;
  onUpdateNodeConfig: (patch: Record<string, unknown>) => void;
  onToggleUpstream: (upstreamId: string, enabled: boolean) => void;
}) {
  const selectedFlowNode =
    spec?.nodes.find((node) => node.id === selectedNode) ?? spec?.nodes[0] ?? null;

  return (
    <div className="canvas-page">
      <aside className="flow-library">
        <div className="section-title">
          <div>
            <h3>研究流程</h3>
            <p>
              标准链路：来源 → 标准化 → 去重 → 聚类 → AI 总结 → 证据报告；可在右侧画布任意定制分支与汇聚 DAG。
            </p>
          </div>
        </div>
        <div className="workflow-picker">
          {projectWorkflows.map((item) => (
            <button
              className={item.id === selectedWorkflow ? 'active' : ''}
              key={item.id}
              onClick={() => onSelectWorkflow(item.id)}
            >
              <strong>{item.name}</strong>
              <small>
                r{item.revision} · v{item.published_version}
              </small>
            </button>
          ))}
        </div>
        <div className="node-library">
          <h4>可用节点库</h4>
          {(Object.keys(nodeMeta) as NodeType[]).map((type) => {
            const exists = spec?.nodes.some((node) => node.type === type);
            return (
              <button
                key={type}
                disabled={!spec || Boolean(type !== 'source' && exists)}
                onClick={() => onAddNode(type)}
              >
                <i>{nodeMeta[type].icon}</i>
                <span>
                  <strong>{nodeMeta[type].label}</strong>
                  <small>{nodeMeta[type].copy}</small>
                </span>
                <b>{type === 'source' || !exists ? '＋' : '✓'}</b>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="flow-workspace">
        {workflow && spec ? (
          <>
            <header className="flow-toolbar">
              <div>
                <p className="eyebrow">VISUAL WORKFLOW DAG</p>
                <h2>{workflow.name}</h2>
                <span>
                  {spec.nodes.filter((node) => node.type === 'source').length} 个来源并行汇聚 · 草稿 r
                  {workflow.revision} · 已发布 v{workflow.published_version}
                </span>
              </div>
              <div>
                <button onClick={() => void onWorkflowAction('save')} disabled={busy}>
                  保存草稿
                </button>
                <button onClick={() => void onWorkflowAction('publish')} disabled={busy}>
                  验证并发布
                </button>
                <button
                  className="run-button"
                  onClick={() => void onWorkflowAction('run')}
                  disabled={busy || !workflow.published_version}
                >
                  ▶ 运行流程
                </button>
              </div>
            </header>

            <div
              className="flow-canvas"
              style={{
                minWidth: Math.max(
                  960,
                  (spec.nodes.filter((node) => node.type !== 'source').length + 1) * 190 + 350,
                ),
                height: Math.max(
                  390,
                  spec.nodes.filter((node) => node.type === 'source').length * 135 + 80,
                ),
              }}
            >
              <svg className="flow-edges" aria-hidden="true">
                <defs>
                  <marker
                    id="flow-arrow"
                    markerWidth="7"
                    markerHeight="7"
                    refX="6"
                    refY="3.5"
                    orient="auto"
                  >
                    <path d="M0,0 L7,3.5 L0,7 Z" fill="#3b82f6" />
                  </marker>
                </defs>
                {spec.edges.map((edge) => {
                  const from = spec.nodes.find((node) => node.id === edge.source);
                  const to = spec.nodes.find((node) => node.id === edge.target);
                  if (!from || !to) return null;
                  const x1 = from.x + 145;
                  const y1 = from.y + 56;
                  const x2 = to.x;
                  const y2 = to.y + 56;
                  const curve = Math.max(35, (x2 - x1) / 2);
                  return (
                    <path
                      key={edge.id}
                      d={`M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`}
                      markerEnd="url(#flow-arrow)"
                    />
                  );
                })}
              </svg>

              {spec.nodes.map((node, index) => (
                <div
                  key={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`编辑${node.label}`}
                  className={`canvas-node node-${node.type} ${
                    selectedFlowNode?.id === node.id ? 'selected' : ''
                  } ${dragged === node.id ? 'is-dragging' : ''}`}
                  draggable={node.type !== 'source'}
                  onClick={() => onSelectNode(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectNode(node.id);
                  }}
                  onDragStart={() => onSetDragged(node.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDropNode(node.id, event)}
                  style={{ left: node.x, top: node.y }}
                >
                  <header>
                    <i>{nodeMeta[node.type].icon}</i>
                    <small>{String(index + 1).padStart(2, '0')}</small>
                  </header>
                  <strong>{node.label}</strong>
                  <p>{nodeMeta[node.type].copy}</p>
                  {(node.type !== 'source' ||
                    spec.nodes.filter((item) => item.type === 'source').length > 1) && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveNode(node.id);
                      }}
                      aria-label={`删除${node.label}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>

            {selectedFlowNode && (
              <aside className="node-inspector node-inspector-rich">
                <div>
                  <p className="eyebrow">NODE INSPECTOR</p>
                  <h3>{selectedFlowNode.label}</h3>
                  <span className="node-ready">● 已接入执行器</span>
                </div>

                {selectedFlowNode.type === 'source' && (
                  <>
                    <label>
                      项目来源
                      <select
                        value={String(selectedFlowNode.config['projectSourceId'] ?? '')}
                        onChange={(event) => {
                          const source = projectSources.find(
                            (item) => item.id === event.target.value,
                          );
                          const config = source
                            ? safeJson<Record<string, unknown>>(source.config_json, {})
                            : {};
                          onUpdateNodeConfig({
                            projectSourceId: event.target.value,
                            platform: source
                              ? ['rss', 'rest', 'web'].includes(source.kind)
                                ? source.kind
                                : String(
                                    config['platform'] ??
                                      selectedFlowNode.config['platform'] ??
                                      'bluesky',
                                  )
                              : selectedFlowNode.config['platform'] ?? 'bluesky',
                          });
                        }}
                      >
                        <option value="">直接选择平台</option>
                        {projectSources.map((source) => (
                          <option key={source.id} value={source.id}>
                            {source.name} · {source.kind}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      平台
                      <input
                        list="studio-platforms"
                        value={String(selectedFlowNode.config['platform'] ?? 'bluesky')}
                        onChange={(event) => onUpdateNode('platform', event.target.value)}
                      />
                      <datalist id="studio-platforms">
                        {platformCatalog.map((id) => (
                          <option value={id} key={id}>
                            {platforms[id] ?? (id.startsWith('opencli:') ? id.slice(8) : id)}
                          </option>
                        ))}
                      </datalist>
                    </label>
                    <label>
                      关键词
                      <input
                        value={String(selectedFlowNode.config['keyword'] ?? '')}
                        onChange={(event) => onUpdateNode('keyword', event.target.value)}
                      />
                    </label>
                    <label>
                      采集上限
                      <input
                        type="number"
                        min="1"
                        max="1000"
                        value={Number(selectedFlowNode.config['limit'] ?? 100)}
                        onChange={(event) => onUpdateNode('limit', Number(event.target.value))}
                      />
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={selectedFlowNode.config['includeComments'] !== false}
                        onChange={(event) => onUpdateNode('includeComments', event.target.checked)}
                      />
                      采集评论/回复
                    </label>
                  </>
                )}

                {selectedFlowNode.type === 'filter' && (
                  <>
                    <label>
                      字段
                      <input
                        value={String(selectedFlowNode.config['field'] ?? 'content')}
                        onChange={(event) => onUpdateNode('field', event.target.value)}
                      />
                    </label>
                    <label>
                      操作符
                      <select
                        value={String(selectedFlowNode.config['operator'] ?? 'contains')}
                        onChange={(event) => onUpdateNode('operator', event.target.value)}
                      >
                        <option value="contains">包含</option>
                        <option value="equals">等于</option>
                        <option value="regex">正则匹配</option>
                        <option value="gte">大于等于</option>
                        <option value="lte">小于等于</option>
                      </select>
                    </label>
                    <label>
                      比较值
                      <input
                        value={String(selectedFlowNode.config['value'] ?? '')}
                        onChange={(event) => onUpdateNode('value', event.target.value)}
                      />
                    </label>
                  </>
                )}

                {selectedFlowNode.type === 'gate' && (
                  <>
                    <label>
                      指标
                      <select
                        value={String(selectedFlowNode.config['metric'] ?? 'itemCount')}
                        onChange={(event) => onUpdateNode('metric', event.target.value)}
                      >
                        <option value="itemCount">记录数量</option>
                        <option value="qualityScore">质量分</option>
                        <option value="sourceCount">成功来源数</option>
                      </select>
                    </label>
                    <label>
                      阈值
                      <input
                        type="number"
                        value={Number(selectedFlowNode.config['threshold'] ?? 1)}
                        onChange={(event) => onUpdateNode('threshold', Number(event.target.value))}
                      />
                    </label>
                    <label>
                      不通过时
                      <select
                        value={String(selectedFlowNode.config['onReject'] ?? 'stop')}
                        onChange={(event) => onUpdateNode('onReject', event.target.value)}
                      >
                        <option value="stop">停止运行</option>
                        <option value="skip">跳过后续</option>
                        <option value="continue">记录告警并继续</option>
                      </select>
                    </label>
                  </>
                )}

                {selectedFlowNode.type === 'agent' && (
                  <>
                    <label>
                      绑定 Skill
                      <select
                        required
                        value={String(selectedFlowNode.config['skillId'] ?? '')}
                        onChange={(event) => onUpdateNode('skillId', event.target.value)}
                      >
                        <option value="" disabled>
                          选择已发布 Skill
                        </option>
                        {skills.map((skill) => (
                          <option key={skill.id} value={skill.id}>
                            {skill.name} · v{skill.current_version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      最大迭代
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={Number(selectedFlowNode.config['maxIterations'] ?? 10)}
                        onChange={(event) => onUpdateNode('maxIterations', Number(event.target.value))}
                      />
                    </label>
                    <label className="inspector-wide">
                      导航 Allowlist
                      <input
                        value={
                          Array.isArray(selectedFlowNode.config['allowlist'])
                            ? (selectedFlowNode.config['allowlist'] as string[]).join(', ')
                            : ''
                        }
                        onChange={(event) =>
                          onUpdateNode(
                            'allowlist',
                            event.target.value.split(/[\s,]+/).filter(Boolean),
                          )
                        }
                        placeholder="默认使用 Skill domain，可填写 example.com, *.example.org"
                      />
                    </label>
                    <label className="inspector-wide">
                      研究指令
                      <textarea
                        rows={3}
                        value={String(selectedFlowNode.config['instructions'] ?? '')}
                        onChange={(event) => onUpdateNode('instructions', event.target.value)}
                        placeholder="描述目标、边界与输出要求"
                      />
                    </label>
                    {!skills.length && (
                      <p className="permission-hint">请先到自动化 Skills 页面创建并发布 Skill。</p>
                    )}
                  </>
                )}

                {selectedFlowNode.type === 'dataset' && (
                  <>
                    <label>
                      数据集名称
                      <input
                        value={String(selectedFlowNode.config['name'] ?? 'research-results')}
                        onChange={(event) => onUpdateNode('name', event.target.value)}
                      />
                    </label>
                    <label>
                      写入方式
                      <select
                        value={String(selectedFlowNode.config['writeMode'] ?? 'append')}
                        onChange={(event) => onUpdateNode('writeMode', event.target.value)}
                      >
                        <option value="append">追加</option>
                        <option value="upsert">按来源标识更新</option>
                        <option value="replace">覆盖</option>
                      </select>
                    </label>
                  </>
                )}

                {selectedFlowNode.type === 'deliver' && (
                  <>
                    <label>
                      交付渠道
                      <select
                        value={String(selectedFlowNode.config['channel'] ?? 'webhook')}
                        onChange={(event) => onUpdateNode('channel', event.target.value)}
                      >
                        <option value="webhook">Webhook</option>
                        <option value="feishu">飞书</option>
                        <option value="dingtalk">钉钉</option>
                        <option value="wecom">企业微信</option>
                        <option value="email">Email HTTPS Gateway</option>
                      </select>
                    </label>
                    <label className="inspector-wide">
                      HTTPS Endpoint
                      <input
                        type="url"
                        value={String(selectedFlowNode.config['endpoint'] ?? '')}
                        onChange={(event) => onUpdateNode('endpoint', event.target.value)}
                        placeholder="https://..."
                      />
                    </label>
                  </>
                )}

                {!['source', 'filter', 'gate', 'agent', 'dataset', 'deliver'].includes(
                  selectedFlowNode.type,
                ) && (
                  <label className="inspector-wide">
                    节点配置
                    <input
                      value={String(
                        selectedFlowNode.config['schema'] ??
                          selectedFlowNode.config['strategy'] ??
                          selectedFlowNode.config['model'] ??
                          selectedFlowNode.config['format'] ??
                          'default',
                      )}
                      onChange={(event) =>
                        onUpdateNode(
                          selectedFlowNode.type === 'normalize'
                            ? 'schema'
                            : selectedFlowNode.type === 'dedupe'
                            ? 'strategy'
                            : selectedFlowNode.type === 'llm'
                            ? 'model'
                            : selectedFlowNode.type === 'report'
                            ? 'format'
                            : 'mode',
                          event.target.value,
                        )
                      }
                    />
                  </label>
                )}

                {selectedFlowNode.type !== 'source' && (
                  <fieldset className="upstream-picker">
                    <legend>上游节点（支持分支与汇聚）</legend>
                    {spec.nodes
                      .filter((node) => node.id !== selectedFlowNode.id)
                      .map((node) => {
                        const checked = spec.edges.some(
                          (edge) =>
                            edge.source === node.id && edge.target === selectedFlowNode.id,
                        );
                        const cycle = reaches(spec, selectedFlowNode.id, node.id);
                        return (
                          <label key={node.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!checked && cycle}
                              onChange={(event) => onToggleUpstream(node.id, event.target.checked)}
                            />
                            {node.label}
                            <small>{node.type}</small>
                          </label>
                        );
                      })}
                  </fieldset>
                )}
                <p>
                  连线决定真实执行依赖；可用“上游节点”构建并行分支与多路汇聚。发布时服务端会验证断链、循环、配置和执行能力。
                </p>
              </aside>
            )}
          </>
        ) : (
          <div className="studio-empty large">先在“项目”中创建并打开一个研究流程。</div>
        )}
      </section>
    </div>
  );
}
