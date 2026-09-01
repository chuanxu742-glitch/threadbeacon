'use client';

import { formatDate, type Checkpoint, type EventItem, type Run } from './types.js';

export function RunsView({
  runs,
  checkpoints,
  events,
}: {
  runs: Run[];
  checkpoints: Checkpoint[];
  events: EventItem[];
}) {
  return (
    <div className="product-page">
      <div className="section-title page-title">
        <div>
          <h3>运行记录与节点 Trace</h3>
          <p>每个发布版本的执行都保留实时事件、检查点状态与阶段输出</p>
        </div>
        <span>{runs.length} 次运行</span>
      </div>

      <div className="run-board">
        {runs.map((run) => {
          const points = checkpoints.filter((point) => point.run_id === run.id);
          const runEvents = events.filter((item) => item.run_id === run.id);
          return (
            <article className="run-card" key={run.id}>
              <header>
                <span className={`status ${run.status}`}>
                  <i />
                  {run.status}
                </span>
                <div>
                  <strong>
                    {run.workflow_name} · v{run.version}
                  </strong>
                  <small>
                    {run.project_name ?? '未归档项目'} · {formatDate(run.started_at)}
                  </small>
                </div>
                <code>{run.job_id.slice(0, 8)}</code>
              </header>
              <div className="checkpoint-track">
                {points.map((point, index) => (
                  <div key={point.id} className={point.status}>
                    <i>{index + 1}</i>
                    <span>
                      <strong>{point.node_id}</strong>
                      <small>
                        {point.status} · {formatDate(point.finished_at ?? point.started_at)}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
              <details>
                <summary>查看事件时间线（{runEvents.length} 条记录）</summary>
                {runEvents.map((item) => (
                  <p key={item.id}>
                    <code>{item.node_id}</code>
                    <span>{item.message}</span>
                    <time>{formatDate(item.created_at)}</time>
                  </p>
                ))}
              </details>
            </article>
          );
        })}
        {!runs.length && (
          <div className="studio-empty large">发布并运行研究流程后，这里会显示节点 Trace。</div>
        )}
      </div>
    </div>
  );
}
