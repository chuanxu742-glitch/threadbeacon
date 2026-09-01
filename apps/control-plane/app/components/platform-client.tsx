'use client';

import { useCallback, useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { apiJson } from './api-json.js';
import { AppNav } from './app-nav.js';
import { DeliveryView } from './studio/delivery-view.js';
import { EvidenceView } from './studio/evidence-view.js';
import { PluginsView } from './studio/plugins-view.js';
import { ProjectsView } from './studio/projects-view.js';
import { ResourcesView } from './studio/resources-view.js';
import { RunsView } from './studio/runs-view.js';
import {
  nodeMeta,
  platforms,
  safeJson,
  tabs,
  type ApiToken,
  type NodeType,
  type StudioData,
  type Tab,
  type WebhookTrigger,
  type Workflow,
  type WorkflowNode,
  type WorkflowSpec,
} from './studio/types.js';
import { reaches, specWith, WorkflowCanvas } from './studio/workflow-canvas.js';

const empty: StudioData = {
  workspace: null,
  templates: [],
  projects: [],
  sources: [],
  workflows: [],
  runs: [],
  events: [],
  checkpoints: [],
  evidence: [],
  evidenceLinks: [],
  relationships: [],
  plugins: [],
  profiles: [],
  nodes: [],
  rules: [],
  auditLogs: [],
  deliveryLogs: [],
  skills: [],
};

const tabIds = new Set<Tab>(tabs.map((item) => item.id));
function tabFromHash(): Tab {
  const value = location.hash.slice(1) as Tab;
  return tabIds.has(value) ? value : 'projects';
}

function rebuildGraph(nodes: WorkflowNode[]): WorkflowSpec {
  const sourceNodes = nodes.filter((node) => node.type === 'source');
  const processing = nodes.filter((node) => node.type !== 'source');
  const positioned = [
    ...sourceNodes.map((node, index) => ({
      ...node,
      x: 45,
      y: 35 + index * 135,
      label: node.label || `采集来源 ${index + 1}`,
    })),
    ...processing.map((node, index) => ({ ...node, x: 260 + index * 190, y: 105 })),
  ];
  const first = processing[0];
  const edges = [
    ...(first
      ? sourceNodes.map((node, index) => ({
          id: `edge-source-${index + 1}`,
          source: node.id,
          target: first.id,
        }))
      : []),
    ...processing.slice(1).map((node, index) => ({
      id: `edge-step-${index + 1}`,
      source: processing[index]!.id,
      target: node.id,
    })),
  ];
  return specWith(positioned, edges);
}

function parseSpec(workflow: Workflow): WorkflowSpec {
  const fallback: WorkflowSpec = {
    source: { platform: 'bluesky', keyword: '', limit: 100, includeComments: true },
    sources: [],
    steps: [],
    nodes: [],
    edges: [],
  };
  const parsed = safeJson(workflow.draft_json, fallback);
  if (!parsed.nodes?.length) {
    const legacySources = parsed.sources?.length ? parsed.sources : [parsed.source];
    parsed.nodes = legacySources.map((source, index) => ({
      id: `source-${index + 1}`,
      type: 'source',
      label: `采集来源 ${index + 1}`,
      x: 45,
      y: 35 + index * 135,
      config: { ...source },
    }));
    for (const [index, type] of (parsed.steps ?? []).entries()) {
      parsed.nodes.push({
        id: `${type}-${index + 1}`,
        type: type as NodeType,
        label: nodeMeta[type as NodeType]?.label ?? type,
        x: 0,
        y: 0,
        config: {},
      });
    }
  }
  const ids = new Set(parsed.nodes.map((node) => node.id));
  const validEdges = (parsed.edges ?? []).filter(
    (edge) => ids.has(edge.source) && ids.has(edge.target) && edge.source !== edge.target,
  );
  return validEdges.length ? specWith(parsed.nodes, validEdges) : rebuildGraph(parsed.nodes);
}

export function PlatformClient({
  user,
  onSignOut,
}: {
  user: { displayName: string; email: string };
  onSignOut: () => void;
}) {
  const [data, setData] = useState<StudioData>(empty);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [spec, setSpec] = useState<WorkflowSpec | null>(null);
  const [dragged, setDragged] = useState('');
  const [selectedNode, setSelectedNode] = useState('');
  const [webhooks, setWebhooks] = useState<WebhookTrigger[]>([]);
  const [webhookToken, setWebhookToken] = useState('');
  const [copied, setCopied] = useState('');
  const [apiTokens, setApiTokens] = useState<ApiToken[]>([]);
  const [plainToken, setPlainToken] = useState('');

  const refresh = useCallback(
    async (preferredWorkflow?: string) => {
      try {
        const response = await fetch('/api/studio', { cache: 'no-store' });
        const body = (await apiJson(response)) as StudioData & { error?: string };
        if (!response.ok) throw new Error(body.error ?? '加载失败');
        setData(body);

        const project =
          body.projects.find((item) => item.id === selectedProject)?.id ??
          body.projects[0]?.id ??
          '';
        setSelectedProject(project);

        const workflow =
          body.workflows.find((item) => item.id === (preferredWorkflow || selectedWorkflow)) ??
          body.workflows.find((item) => item.project_id === project) ??
          body.workflows[0];
        setSelectedWorkflow(workflow?.id ?? '');
        setSpec(workflow ? parseSpec(workflow) : null);
        setError('');
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '加载失败');
      }
    },
    [selectedProject, selectedWorkflow],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (tab !== 'runs' || !data.runs.some((run) => ['queued', 'running'].includes(run.status))) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [tab, data.runs, refresh]);

  function setTabAndHash(next: Tab) {
    setTab(next);
    if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  }

  const workflow = data.workflows.find((item) => item.id === selectedWorkflow) ?? null;
  const projectWorkflows = data.workflows.filter(
    (item) => !selectedProject || item.project_id === selectedProject,
  );
  const projectSources = data.sources.filter((item) => item.project_id === selectedProject);
  const selectedFlowNode =
    spec?.nodes.find((node) => node.id === selectedNode) ?? spec?.nodes[0] ?? null;

  const workerPlatforms = useMemo(
    () =>
      [...new Set(data.nodes.flatMap((node) => safeJson<string[]>(node.capabilities_json, [])))]
        .filter(
          (item) =>
            !item.includes('/') &&
            ![
              'source',
              'normalize',
              'dedupe',
              'filter',
              'gate',
              'cluster',
              'llm',
              'agent',
              'report',
              'dataset',
              'deliver',
            ].includes(item),
        ),
    [data.nodes],
  );

  const platformCatalog = useMemo(
    () =>
      [...new Set([...Object.keys(platforms), ...workerPlatforms])].sort((a, b) =>
        (platforms[a] ?? a).localeCompare(platforms[b] ?? b, 'zh-CN'),
      ),
    [workerPlatforms],
  );

  const stats = useMemo(
    () => ({
      projects: data.projects.length,
      activeRuns: data.runs.filter((run) => ['queued', 'running'].includes(run.status)).length,
      online: data.nodes.filter((node) => node.status === 'online').length,
      evidence: data.evidence.length,
    }),
    [data],
  );

  const canWrite = (data.workspace?.role ?? 'owner') !== 'viewer';

  function requireWrite() {
    if (canWrite) return;
    throw new Error('当前数据为只读状态，暂时不能修改。');
  }

  async function postStudio(payload: Record<string, unknown>) {
    requireWrite();
    const response = await fetch('/api/studio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await apiJson(response)) as { error?: string };
    if (!response.ok) throw new Error(body.error ?? '操作失败');
  }

  async function reviewFinding(
    id: string,
    action: 'approve' | 'edit' | 'reject',
    values: { theme?: string; summary?: string; severity?: number; rationale?: string } = {},
  ) {
    requireWrite();
    setBusy(true);
    try {
      const response = await fetch(`/api/findings/${encodeURIComponent(id)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ...values }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '复核失败');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '复核失败');
      throw caught;
    } finally {
      setBusy(false);
    }
  }

  async function loadWebhooks() {
    try {
      const response = await fetch('/api/integrations/webhooks', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await apiJson(response)) as { triggers?: WebhookTrigger[] };
      setWebhooks(body.triggers ?? []);
    } catch {
      // 集成接口不可用时不影响工作台其他模块
    }
  }

  async function loadTokens() {
    try {
      const response = await fetch('/api/integrations/tokens', { cache: 'no-store' });
      if (!response.ok) return;
      const body = (await apiJson(response)) as { tokens?: ApiToken[] };
      setApiTokens(body.tokens ?? []);
    } catch {
      // Token 接口不可用时不影响工作台其他模块
    }
  }

  useEffect(() => {
    if (tab !== 'plugins') return;
    const timer = window.setTimeout(() => {
      void loadWebhooks();
      void loadTokens();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tab]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await postStudio({
        action: 'create-project',
        name: values.get('name'),
        description: values.get('description'),
        template: values.get('template'),
      });
      form.reset();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function createSource(event: FormEvent<HTMLFormElement>, kind: string) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const secretName = String(values.get('secretHeader') ?? '').trim();
    const secretEnv = String(values.get('secretEnv') ?? '').trim();
    const command = String(values.get('command') ?? '').trim();
    const rawArgs = String(values.get('args') ?? '').trim();

    let args: string[] = [];
    if (rawArgs) {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;
        if (Array.isArray(parsed)) args = parsed.map(String);
        else throw new Error();
      } catch {
        args = rawArgs
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }

    const config =
      kind === 'opencli'
        ? {
            url: values.get('endpoint'),
            ...(command ? { command } : {}),
            ...(args.length ? { args } : {}),
          }
        : {
            url: values.get('endpoint'),
            itemsPath: values.get('itemsPath'),
            keyword: values.get('defaultKeyword'),
            ...(secretName && secretEnv ? { secretHeaders: { [secretName]: secretEnv } } : {}),
          };

    try {
      await postStudio({
        action: 'create-source',
        projectId: selectedProject,
        name: values.get('name'),
        kind,
        config,
      });
      form.reset();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function testSource(sourceId: string) {
    setBusy(true);
    try {
      await postStudio({ action: 'test-source', sourceId });
      await refresh();
      setTabAndHash('runs');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '试运行失败');
    } finally {
      setBusy(false);
    }
  }

  async function createWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const binding = String(values.get('sourceBinding') ?? 'platform:bluesky');
    const sourceId = binding.startsWith('source:') ? binding.slice(7) : '';
    const registered = projectSources.find((item) => item.id === sourceId);
    const config = registered ? safeJson<Record<string, unknown>>(registered.config_json, {}) : {};
    const platform = registered
      ? ['rss', 'rest', 'web'].includes(registered.kind)
        ? registered.kind
        : String(config['platform'] ?? 'bluesky')
      : binding.slice(9);
    const source = {
      platform,
      keyword: values.get('keyword'),
      limit: Number(values.get('limit')),
      includeComments: true,
      ...(sourceId ? { projectSourceId: sourceId } : {}),
    };

    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProject,
          name: values.get('name'),
          description: values.get('description'),
          spec: { source, steps: ['normalize', 'dedupe', 'cluster', 'llm', 'report'] },
        }),
      });
      const body = (await apiJson(response)) as { workflow?: Workflow; error?: string };
      if (!response.ok) throw new Error(body.error);
      form.reset();
      await refresh(body.workflow?.id);
      setTabAndHash('workflow');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function workflowAction(action: 'save' | 'publish' | 'run') {
    if (!workflow || !spec) return;
    setBusy(true);
    try {
      const payload = action === 'save' ? { revision: workflow.revision, spec } : { action };
      const response = await fetch(`/api/workflows/${workflow.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error);
      await refresh(workflow.id);
      if (action === 'run') setTabAndHash('runs');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function selectWorkflow(id: string) {
    const next = data.workflows.find((item) => item.id === id);
    setSelectedWorkflow(id);
    setSpec(next ? parseSpec(next) : null);
    setTabAndHash('workflow');
  }

  function updateNodeConfig(patch: Record<string, unknown>) {
    if (!spec || !selectedFlowNode) return;
    const nodes = spec.nodes.map((node) =>
      node.id === selectedFlowNode.id ? { ...node, config: { ...node.config, ...patch } } : node,
    );
    setSpec(specWith(nodes, spec.edges));
  }

  function updateNode(key: string, value: unknown) {
    updateNodeConfig({ [key]: value });
  }

  function addNode(type: NodeType) {
    if (!spec || (type !== 'source' && spec.nodes.some((node) => node.type === type))) return;
    const count = spec.nodes.filter((node) => node.type === type).length + 1;
    const defaults: Record<NodeType, Record<string, unknown>> = {
      source: { platform: 'bluesky', keyword: '', limit: 100, includeComments: true },
      normalize: { schema: 'standard-v1' },
      dedupe: { strategy: 'content-hash' },
      filter: { field: 'content', operator: 'contains', value: '' },
      gate: { metric: 'itemCount', operator: 'gte', threshold: 1, onReject: 'stop' },
      cluster: { minClusterSize: 3 },
      llm: { model: 'default', prompt: '' },
      agent: {
        skillId: data.skills[0]?.id ?? '',
        maxIterations: 10,
        instructions: '',
        allowlist: [],
      },
      report: { format: 'evidence' },
      dataset: { name: 'research-results', writeMode: 'append' },
      deliver: { channel: 'webhook', endpoint: '' },
    };
    const next = {
      id: `${type}-${spec.nodes.length + 1}-${count}`,
      type,
      label: type === 'source' ? `采集来源 ${count}` : nodeMeta[type].label,
      x: 0,
      y: 0,
      config: defaults[type],
    };
    const edges = [...spec.edges];
    if (type === 'source') {
      const roots = spec.nodes.filter(
        (node) => node.type !== 'source' && !spec.edges.some((edge) => edge.target === node.id),
      );
      for (const root of roots) edges.push({ id: `edge-${next.id}-${root.id}`, source: next.id, target: root.id });
    } else {
      const terminals = spec.nodes.filter(
        (node) => !spec.edges.some((edge) => edge.source === node.id),
      );
      for (const terminal of terminals) {
        edges.push({ id: `edge-${terminal.id}-${next.id}`, source: terminal.id, target: next.id });
      }
    }
    setSpec(specWith([...spec.nodes, next], edges));
    setSelectedNode(next.id);
  }

  function removeNode(id: string) {
    if (!spec) return;
    const target = spec.nodes.find((node) => node.id === id);
    if (target?.type === 'source' && spec.nodes.filter((node) => node.type === 'source').length === 1) {
      return;
    }
    const incoming = spec.edges.filter((edge) => edge.target === id);
    const outgoing = spec.edges.filter((edge) => edge.source === id);
    const edges = spec.edges.filter((edge) => edge.source !== id && edge.target !== id);

    for (const before of incoming) {
      for (const after of outgoing) {
        if (
          before.source !== after.target &&
          !edges.some((edge) => edge.source === before.source && edge.target === after.target)
        ) {
          edges.push({
            id: `edge-${before.source}-${after.target}`,
            source: before.source,
            target: after.target,
          });
        }
      }
    }
    setSpec(specWith(spec.nodes.filter((node) => node.id !== id), edges));
    if (selectedNode === id) setSelectedNode('');
  }

  function dropNode(target: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!spec || !dragged || dragged === target) return;
    const moving = spec.nodes.find((node) => node.id === dragged);
    if (!moving || moving.type === 'source') return;

    const sources = spec.nodes.filter((node) => node.type === 'source');
    const processing = spec.nodes.filter((node) => node.type !== 'source' && node.id !== dragged);
    const index = processing.findIndex((node) => node.id === target);
    processing.splice(Math.max(0, index), 0, moving);

    const relaid = [...sources, ...processing].map((node) => ({
      ...node,
      x: node.type === 'source' ? node.x : 0,
      y: node.type === 'source' ? node.y : 0,
    }));
    setSpec(specWith(relaid, spec.edges));
    setDragged('');
  }

  function toggleUpstream(upstreamId: string, enabled: boolean) {
    if (!spec || !selectedFlowNode || selectedFlowNode.type === 'source') return;
    const exists = spec.edges.some(
      (edge) => edge.source === upstreamId && edge.target === selectedFlowNode.id,
    );
    let edges = spec.edges;
    if (enabled && !exists && !reaches(spec, selectedFlowNode.id, upstreamId)) {
      edges = [...edges, { id: `edge-${upstreamId}-${selectedFlowNode.id}`, source: upstreamId, target: selectedFlowNode.id }];
    }
    if (!enabled && exists) {
      edges = edges.filter((edge) => !(edge.source === upstreamId && edge.target === selectedFlowNode.id));
    }
    setSpec(specWith(spec.nodes, edges));
  }

  async function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await postStudio({
        action: 'create-browser-profile',
        name: values.get('name'),
        profileName: values.get('profileName'),
        profileKind: values.get('profileKind'),
        mode: values.get('mode'),
        nodeId: values.get('nodeId'),
        sites: String(values.get('sites') ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        noVncUrl: values.get('noVncUrl'),
        cdpUrl: values.get('cdpUrl'),
      });
      form.reset();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/governance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          kind: values.get('kind'),
          endpoint: values.get('endpoint'),
          projectId: values.get('projectId'),
        }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error);
      form.reset();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(id: string) {
    await fetch(`/api/governance/delivery/${id}`, { method: 'PATCH' });
    await refresh();
  }

  async function importDify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const file = values.get('file');
    const projectSourceId = String(values.get('projectSourceId') ?? '');

    try {
      if (!(file instanceof File) || !file.size) throw new Error('请选择 Dify YAML / YML 文件');
      if (!projectSourceId) throw new Error('请先登记并选择一个项目数据源');
      const payload = new FormData();
      payload.set('file', file);
      payload.set('projectId', String(values.get('projectId') ?? selectedProject));
      payload.set('projectSourceId', projectSourceId);

      const response = await fetch('/api/integrations/dify/import', { method: 'POST', body: payload });
      const body = (await apiJson(response)) as { error?: string; workflow?: Workflow };
      if (!response.ok) throw new Error(body.error ?? '导入失败');
      form.reset();
      await refresh(body.workflow?.id);
      setTabAndHash('workflow');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }

  async function createWebhook(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch('/api/integrations/webhooks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: values.get('projectId'),
          name: values.get('name'),
          workflowId: values.get('workflowId'),
          enabled: true,
        }),
      });
      const body = (await apiJson(response)) as {
        error?: string;
        trigger?: WebhookTrigger;
        token?: string;
        webhookUrl?: string;
      };
      if (!response.ok) throw new Error(body.error ?? '创建失败');
      setWebhookToken(
        body.webhookUrl ?? (body.token ? `${location.origin}/api/integrations/webhooks/${body.token}` : ''),
      );
      form.reset();
      await loadWebhooks();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function toggleWebhook(trigger: WebhookTrigger) {
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/webhooks', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: trigger.id, enabled: !Boolean(trigger.enabled) }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '更新失败');
      await loadWebhooks();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '更新失败');
    } finally {
      setBusy(false);
    }
  }

  async function createToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = event.currentTarget;
    const values = new FormData(form);
    const days = Number(values.get('expiresInDays'));

    try {
      const response = await fetch('/api/integrations/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.get('name'),
          role: values.get('role'),
          ...(days > 0 ? { expiresInDays: days } : {}),
        }),
      });
      const body = (await apiJson(response)) as { error?: string; token?: string };
      if (!response.ok) throw new Error(body.error ?? '创建失败');
      setPlainToken(body.token ?? '');
      form.reset();
      await loadTokens();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建失败');
    } finally {
      setBusy(false);
    }
  }

  async function revokeToken(id: string) {
    setBusy(true);
    try {
      const response = await fetch('/api/integrations/tokens', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, action: 'revoke' }),
      });
      const body = (await apiJson(response)) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? '撤销失败');
      await loadTokens();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '撤销失败');
    } finally {
      setBusy(false);
    }
  }

  async function copyText(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setError('浏览器未授权剪贴板，请手动复制。');
    }
  }

  return (
    <main
      className={`workbench-shell ${canWrite ? '' : 'read-only'}`}
      onSubmitCapture={(event) => {
        if (!canWrite) {
          event.preventDefault();
          setError('当前数据为只读状态，暂时不能修改。');
        }
      }}
    >
      <AppNav
        active="studio"
        user={user}
        onSignOut={onSignOut}
        status={error ? 'error' : busy ? 'syncing' : 'healthy'}
        contextLabel="项目工作区"
        contextItems={tabs.map((item) => ({
          id: item.id,
          label: item.label,
          icon: item.icon,
          active: tab === item.id,
          onClick: () => setTabAndHash(item.id),
        }))}
        notice={!canWrite ? <div className="viewer-note">当前数据为只读状态</div> : undefined}
      />
      <section className="workbench-main">
        <header className="workbench-top">
          <div>
            <p className="eyebrow">团队研究工作台</p>
            <h1>{tabs.find((item) => item.id === tab)?.label}</h1>
          </div>
          <div className="studio-metrics">
            <span>
              <b>{stats.projects}</b> 项目
            </span>
            <span>
              <b>{stats.activeRuns}</b> 运行中
            </span>
            <span>
              <b>{stats.online}</b> 节点在线
            </span>
            <span>
              <b>{stats.evidence}</b> 证据
            </span>
            <span>
              <b>{data.productMetrics?.funnel.baseline_completed ?? 0}</b> 基线完成
            </span>
          </div>
          <button className="refresh-button" onClick={() => void refresh()} aria-label="刷新">
            ↻
          </button>
        </header>
        {error && (
          <div className="error-banner studio-error">
            {error}
            <button onClick={() => setError('')}>×</button>
          </div>
        )}

        {tab === 'projects' && (
          <ProjectsView
            projects={data.projects}
            templates={data.templates}
            sources={data.sources}
            workflowsCount={(projectId) =>
              data.workflows.filter((flow) => flow.project_id === projectId).length
            }
            selectedProject={selectedProject}
            busy={busy}
            onSelectProject={setSelectedProject}
            onCreateProject={createProject}
            onCreateSource={createSource}
            onTestSource={testSource}
            onCreateWorkflow={createWorkflow}
          />
        )}

        {tab === 'workflow' && (
          <WorkflowCanvas
            workflow={workflow}
            spec={spec}
            projectWorkflows={projectWorkflows}
            projectSources={projectSources}
            skills={data.skills}
            platformCatalog={platformCatalog}
            selectedWorkflow={selectedWorkflow}
            selectedNode={selectedNode}
            dragged={dragged}
            busy={busy}
            onSelectWorkflow={selectWorkflow}
            onSelectNode={setSelectedNode}
            onSetDragged={setDragged}
            onWorkflowAction={workflowAction}
            onAddNode={addNode}
            onRemoveNode={removeNode}
            onDropNode={dropNode}
            onUpdateNode={updateNode}
            onUpdateNodeConfig={updateNodeConfig}
            onToggleUpstream={toggleUpstream}
          />
        )}

        {tab === 'runs' && (
          <RunsView runs={data.runs} checkpoints={data.checkpoints} events={data.events} />
        )}

        {tab === 'evidence' && (
          <EvidenceView
            evidence={data.evidence}
            evidenceLinks={data.evidenceLinks}
            relationships={data.relationships}
            canWrite={canWrite}
            onReview={reviewFinding}
          />
        )}

        {tab === 'resources' && (
          <ResourcesView
            nodes={data.nodes}
            profiles={data.profiles}
            canWrite={canWrite}
            busy={busy}
            onCreateProfile={createProfile}
          />
        )}

        {tab === 'plugins' && (
          <PluginsView
            plugins={data.plugins}
            projects={data.projects}
            projectSources={projectSources}
            projectWorkflows={projectWorkflows}
            selectedProject={selectedProject}
            webhooks={webhooks}
            webhookToken={webhookToken}
            apiTokens={apiTokens}
            plainToken={plainToken}
            copied={copied}
            busy={busy}
            onSelectProject={setSelectedProject}
            onImportDify={importDify}
            onCreateWebhook={createWebhook}
            onToggleWebhook={toggleWebhook}
            onCreateToken={createToken}
            onRevokeToken={revokeToken}
            onCopyText={copyText}
          />
        )}

        {tab === 'delivery' && (
          <DeliveryView
            rules={data.rules}
            auditLogs={data.auditLogs}
            projects={data.projects}
            selectedProject={selectedProject}
            busy={busy}
            onCreateRule={createRule}
            onToggleRule={toggleRule}
          />
        )}
      </section>
    </main>
  );
}
