import { setImmediate as yieldEventLoop } from 'node:timers/promises';
import type { Message } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

type Waiter = { resolve: (message: Message | undefined) => void; reject: (error: unknown) => void };
type Checkpoint = { threadId: string; message: Message; waiters: Waiter[] };

export class MessageCheckpoints {
  private pending = new Map<string, Checkpoint>();
  private flushing = false;
  constructor(private readonly vault: Pick<WorkspaceVault, 'checkpointMessages'>) {}

  persist(threadId: string, message: Message): Promise<Message | undefined> {
    return new Promise((resolve, reject) => {
      const key = JSON.stringify([threadId, message.id]); const existing = this.pending.get(key);
      if (existing) { existing.message = message; existing.waiters.push({ resolve, reject }); }
      else this.pending.set(key, { threadId, message, waiters: [{ resolve, reject }] });
      this.start();
    });
  }
  private start(): void { if (!this.flushing) { this.flushing = true; void this.flush(); } }
  private async flush(): Promise<void> {
    await yieldEventLoop();
    const batch = [...this.pending.values()]; this.pending.clear();
    try {
      const state = await this.vault.checkpointMessages(batch);
      for (const entry of batch) {
        const saved = state.threads.find((thread) => thread.id === entry.threadId)?.messages.find((message) => message.id === entry.message.id);
        for (const waiter of entry.waiters) waiter.resolve(saved ? structuredClone(saved) : undefined);
      }
    } catch (error) { for (const entry of batch) for (const waiter of entry.waiters) waiter.reject(error); }
    finally { this.flushing = false; if (this.pending.size) this.start(); }
  }
}
