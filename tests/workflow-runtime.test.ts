import { describe, expect, it } from 'vitest';
import { executeWorkflowPostProcessing } from '../src/worker.js';

const report = {
  items: [
    { id: '1', title: '  Keep this  ', score: 8 },
    { id: '1', title: 'Keep this', score: 8 },
    { id: '2', title: 'Drop this', score: 2 },
  ],
  painPoints: [{ theme: 'slow', severity: 4 }],
  generatedAt: '2026-08-28T00:00:00.000Z',
};

describe('workflow worker DAG runtime', () => {
  it('runs filter, gate, agent and dataset nodes with real outputs', () => {
    const nodes = [
      { id: 'source-a', type: 'source' },
      { id: 'normalize-a', type: 'normalize' },
      { id: 'dedupe-a', type: 'dedupe' },
      { id: 'filter-a', type: 'filter', config: { field: 'score', operator: 'gte', value: 5 } },
      { id: 'gate-a', type: 'gate', config: { minItems: 1, minPainPoints: 1 } },
      { id: 'agent-a', type: 'agent', config: { instruction: 'summarize' } },
      { id: 'dataset-a', type: 'dataset', config: { name: 'accepted' } },
    ];
    const edges = nodes.slice(1).map((node, index) => ({ source: nodes[index]!.id, target: node.id }));
    const result = executeWorkflowPostProcessing(report, { nodes, edges }, 'source-a');

    expect(result.status).toBe('completed');
    expect(result.nodes.find((node) => node.nodeId === 'dedupe-a')?.outputCount).toBe(2);
    expect(result.nodes.find((node) => node.nodeId === 'filter-a')?.outputCount).toBe(1);
    expect(result.nodes.find((node) => node.nodeId === 'gate-a')?.status).toBe('completed');
    expect(result.nodes.find((node) => node.nodeId === 'agent-a')?.output).toMatchObject({ topThemes: ['slow'] });
    expect(result.nodes.find((node) => node.nodeId === 'dataset-a')?.output).toMatchObject({ name: 'accepted', rowCount: 1 });
  });

  it('blocks a gate and explicitly skips its downstream nodes', () => {
    const spec = {
      nodes: [
        { id: 'source-a', type: 'source' },
        { id: 'gate-a', type: 'gate', config: { minItems: 99 } },
        { id: 'dataset-a', type: 'dataset' },
      ],
      edges: [{ source: 'source-a', target: 'gate-a' }, { source: 'gate-a', target: 'dataset-a' }],
    };
    const result = executeWorkflowPostProcessing(report, spec, 'source-a');
    expect(result.status).toBe('blocked');
    expect(result.nodes.map((node) => [node.nodeId, node.status])).toEqual([
      ['gate-a', 'blocked'], ['dataset-a', 'skipped'],
    ]);
  });

  it('supports Inspector gate and agent configuration fields', () => {
    const spec = {
      nodes: [
        { id: 'source-a', type: 'source' },
        { id: 'gate-a', type: 'gate', config: { metric: 'itemCount', operator: 'gt', threshold: 99, onReject: 'continue' } },
        { id: 'agent-a', type: 'agent', config: { instructions: 'Use the accepted records' } },
      ],
      edges: [{ source: 'source-a', target: 'gate-a' }, { source: 'gate-a', target: 'agent-a' }],
    };
    const result = executeWorkflowPostProcessing(report, spec, 'source-a');
    expect(result.nodes[0]).toMatchObject({ status: 'completed', output: { passed: false, metric: 'itemCount' } });
    expect(result.nodes[1]?.output).toMatchObject({ instruction: 'Use the accepted records' });
  });

  it('defers a multi-source merge until the control plane has every branch', () => {
    const spec = {
      nodes: [
        { id: 'source-a', type: 'source' }, { id: 'source-b', type: 'source' },
        { id: 'merge-dataset', type: 'dataset' },
      ],
      edges: [{ source: 'source-a', target: 'merge-dataset' }, { source: 'source-b', target: 'merge-dataset' }],
    };
    const result = executeWorkflowPostProcessing(report, spec, 'source-a');
    expect(result.status).toBe('partial');
    expect(result.nodes[0]).toMatchObject({ nodeId: 'merge-dataset', status: 'deferred' });
  });
});
