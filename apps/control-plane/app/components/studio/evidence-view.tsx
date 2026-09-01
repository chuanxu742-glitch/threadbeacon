'use client';

import { useState } from 'react';
import { type Evidence, type EvidenceLink, type Relationship } from './types.js';

export function EvidenceView({
  evidence,
  evidenceLinks,
  relationships,
}: {
  evidence: Evidence[];
  evidenceLinks: EvidenceLink[];
  relationships: Relationship[];
  canWrite: boolean;
  onReview: (id: string, action: 'approve' | 'edit' | 'reject', values?: { theme?: string; summary?: string; severity?: number; rationale?: string }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ theme: '', summary: '', severity: 0, rationale: '' });

  function startEditing(item: Evidence) {
    setEditing(item.id);
    setDraft({ theme: item.theme, summary: item.summary, severity: item.severity, rationale: '' });
  }

  async function submitEdit(id: string) {
    await onReview(id, 'edit', draft);
    setEditing(null);
  }

  return (
    <div className="product-page">
      <div className="section-title page-title">
        <div>
          <h3>证据关系工作台</h3>
          <p>从 AI 发现深度回溯到原始记录，并自动沉淀跨记录实体与观点关系</p>
        </div>
        <span>{evidenceLinks.length} 条关联证据</span>
      </div>

      <div className="evidence-board">
        <section className="finding-column">
          {evidence.map((item) => (
            <article key={item.id}>
              <header>
                <b>S{item.severity}</b>
                <div>
                  <strong>{item.theme}</strong>
                  <small>
                    {item.source_count} 条来源 · {item.linked_count} 条已关联
                  </small>
                </div>
              </header>
              <p>{item.summary}</p>
              {item.uncertainties_json && <small className="finding-uncertainties">仍需确认：{item.uncertainties_json}</small>}
              <div className={`finding-review finding-review-${item.review_status}`}>
                <span>
                  {item.review_status === 'approved'
                    ? '已批准'
                    : item.review_status === 'rejected'
                      ? '已驳回'
                      : '待复核'}
                </span>
                {item.reviewed_at && <small>{new Date(item.reviewed_at).toLocaleString()}</small>}
                {canWrite && item.review_status !== 'approved' && (
                  <button type="button" onClick={() => void onReview(item.id, 'approve')}>
                    批准
                  </button>
                )}
                {canWrite && item.review_status !== 'rejected' && (
                  <button type="button" onClick={() => void onReview(item.id, 'reject')}>
                    驳回
                  </button>
                )}
                {canWrite && <button type="button" onClick={() => startEditing(item)}>编辑</button>}
              </div>
              {editing === item.id && (
                <form
                  className="finding-edit-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitEdit(item.id);
                  }}
                >
                  <input value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value })} aria-label="Finding 主题" />
                  <textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} aria-label="Finding 摘要" rows={3} />
                  <input type="number" min={0} max={5} value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: Number(event.target.value) })} aria-label="严重度" />
                  <input value={draft.rationale} onChange={(event) => setDraft({ ...draft, rationale: event.target.value })} placeholder="复核理由（可选）" aria-label="复核理由" />
                  <button type="submit">保存编辑</button>
                  <button type="button" onClick={() => setEditing(null)}>取消</button>
                </form>
              )}
              <div className="linked-records">
                {evidenceLinks
                  .filter((link) => link.evidence_id === item.id)
                  .slice(0, 8)
                  .map((link) => (
                    <a
                      key={link.id}
                      href={link.url ?? '#'}
                      target={link.url ? '_blank' : undefined}
                      rel="noreferrer"
                    >
                      <i>{link.platform.slice(0, 1).toUpperCase()}</i>
                      <span>
                        <strong>{link.title ?? '原始记录'}</strong>
                        <small>{link.author ?? link.platform}</small>
                      </span>
                    </a>
                  ))}
              </div>
            </article>
          ))}
          {!evidence.length && (
            <div className="studio-empty large">
              完成带有聚类与 AI 归纳的流程后，这里将自动呈现提取到的核心发现与证据链。
            </div>
          )}
        </section>

        <aside className="relationship-column">
          <h3>关系投影</h3>
          <p>同一证据簇中的记录自动形成可查询关系。</p>
          {relationships.map((item) => (
            <article key={item.id}>
              <span>{item.source_title ?? '记录 A'}</span>
              <b>
                {item.relation}
                <small>{item.confidence}%</small>
              </b>
              <span>{item.target_title ?? '记录 B'}</span>
            </article>
          ))}
          {!relationships.length && (
            <div className="studio-empty">完成新的分析任务后自动生成。</div>
          )}
        </aside>
      </div>
    </div>
  );
}
