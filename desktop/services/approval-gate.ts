import { randomUUID } from 'node:crypto';
import type { RunEvent } from '../../contracts/bridge-contract';
import type { ApprovalDetails, ApprovalRequest } from '../../contracts/tools';

type Pending = { request: ApprovalRequest; finish(allowed: boolean): void; cancel(): void };
export class ApprovalGate {
  private requests = new Map<string, Pending>();
  constructor(private readonly emit: (event: RunEvent) => void) {}

  pending(): ApprovalRequest[] { return structuredClone([...this.requests.values()].map((item) => item.request)); }

  ask(threadId: string, messageId: string, toolName: string, details: ApprovalDetails, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    const request: ApprovalRequest = { id: randomUUID(), threadId, messageId, toolName, details, createdAt: Date.now() };
    return new Promise((resolve, reject) => {
      const clear = () => {
        this.requests.delete(request.id);
        signal.removeEventListener('abort', cancel);
        this.emit({ threadId, messageId, approvalResolved: request.id });
      };
      const cancel = () => { clear(); reject(new DOMException('Approval cancelled', 'AbortError')); };
      this.requests.set(request.id, { request, finish: (allowed) => { clear(); resolve(allowed); }, cancel });
      signal.addEventListener('abort', cancel, { once: true });
      this.emit({ threadId, messageId, approval: structuredClone(request) });
    });
  }

  resolve(id: string, allowed: boolean): void {
    const pending = this.requests.get(id);
    if (!pending) throw new Error('This approval is no longer pending.');
    pending.finish(allowed);
  }
}
