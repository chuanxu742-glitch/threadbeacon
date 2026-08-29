export interface GatewayResultEnvelope {
  jobId: string;
  status: 'completed' | 'failed';
  report?: unknown;
  error?: string;
  agentId: string;
  completedAt: string;
  attempt?: number;
}

export interface GatewayCoordination {
  acquireLease(jobId: string, owner: string, ttlMs: number): Promise<boolean>;
  renewLease(jobId: string, owner: string, ttlMs: number): Promise<boolean>;
  releaseLease(jobId: string, owner: string): Promise<void>;
  getResult(jobId: string): Promise<GatewayResultEnvelope | null>;
  deleteResult(jobId: string): Promise<void>;
  publishResult(result: GatewayResultEnvelope, ttlMs: number): Promise<void>;
  waitForResult(jobId: string, timeoutMs: number): Promise<GatewayResultEnvelope | null>;
  close(): Promise<void>;
}

interface Lease { owner: string; expiresAt: number }
interface Cached { result: GatewayResultEnvelope; expiresAt: number }

export class InMemoryGatewayCoordination implements GatewayCoordination {
  private readonly leases = new Map<string, Lease>();
  private readonly results = new Map<string, Cached>();
  private readonly waiters = new Map<string, Set<(result: GatewayResultEnvelope) => void>>();

  async acquireLease(jobId: string, owner: string, ttlMs: number): Promise<boolean> {
    const current = this.leases.get(jobId); const now = Date.now();
    if (current && current.expiresAt > now && current.owner !== owner) return false;
    this.leases.set(jobId, { owner, expiresAt: now + ttlMs }); return true;
  }
  async renewLease(jobId: string, owner: string, ttlMs: number): Promise<boolean> {
    const current = this.leases.get(jobId); if (!current || current.owner !== owner || current.expiresAt <= Date.now()) return false;
    current.expiresAt = Date.now() + ttlMs; return true;
  }
  async releaseLease(jobId: string, owner: string): Promise<void> { if (this.leases.get(jobId)?.owner === owner) this.leases.delete(jobId); }
  async getResult(jobId: string): Promise<GatewayResultEnvelope | null> {
    const cached = this.results.get(jobId); if (!cached) return null;
    if (cached.expiresAt <= Date.now()) { this.results.delete(jobId); return null; }
    return cached.result;
  }
  async deleteResult(jobId: string) { this.results.delete(jobId); }
  async publishResult(result: GatewayResultEnvelope, ttlMs: number): Promise<void> {
    this.results.set(result.jobId, { result, expiresAt: Date.now() + ttlMs });
    for (const resolve of this.waiters.get(result.jobId) ?? []) resolve(result);
    this.waiters.delete(result.jobId);
  }
  async waitForResult(jobId: string, timeoutMs: number): Promise<GatewayResultEnvelope | null> {
    const existing = await this.getResult(jobId); if (existing) return existing;
    return new Promise((resolve) => {
      const waiter = (result: GatewayResultEnvelope) => { clearTimeout(timer); resolve(result); };
      const listeners = this.waiters.get(jobId) ?? new Set(); listeners.add(waiter); this.waiters.set(jobId, listeners);
      const timer = setTimeout(() => { listeners.delete(waiter); if (!listeners.size) this.waiters.delete(jobId); resolve(null); }, timeoutMs);
      void this.getResult(jobId).then((raced) => { if (raced && listeners.has(waiter)) { listeners.delete(waiter); waiter(raced); } });
    });
  }
  async close(): Promise<void> { this.leases.clear(); this.results.clear(); this.waiters.clear(); }
}
