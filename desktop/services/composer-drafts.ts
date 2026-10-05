import { z } from 'zod';
import { composerDraftSchema, type ComposerDraft } from '../../contracts/workspace';
import type { ComposerTransaction, WorkspaceVault } from './vault';

type Activation = { id?: string; resolve: () => void; reject: (error: unknown) => void };

export class ComposerDrafts {
  private pendingActivation?: { requests: Activation[]; temporary: boolean };
  constructor(private readonly vault: WorkspaceVault) {}

  async save(raw: unknown): Promise<void> {
    const draft = composerDraftSchema.parse(raw);
    await this.vault.commitComposer(state => this.applyDraft(state, draft));
  }

  private applyDraft(state: ComposerTransaction, draft: ComposerDraft): void {
    if (draft.threadId && !state.threads.some((thread) => thread.id === draft.threadId)) throw new Error('This conversation no longer exists. Its draft cannot be saved.');
    if (draft.assistantId && !state.assistants.some((assistant) => assistant.id === draft.assistantId)) delete draft.assistantId;
    const index = state.composerDrafts.findIndex((item) => item.threadId === draft.threadId);
    if (!draft.text.length && !draft.attachments.length) { if (index >= 0) state.composerDrafts.splice(index, 1); }
    else if (index < 0) { if (state.composerDrafts.length >= 100) throw new Error('Conversation drafts are limited to 100 owners. Send or clear an existing draft first.'); state.composerDrafts.push(draft); }
    else state.composerDrafts[index] = draft;
    if (Buffer.byteLength(JSON.stringify(state.composerDrafts), 'utf8') > 32_000_000) throw new Error('Conversation drafts exceed 32 MB. Send or clear an existing draft before saving more.');
  }

  async activate(raw?: unknown, rawDrafts?: unknown): Promise<void> {
    const id = z.string().min(1).max(128).optional().parse(raw);
    if (rawDrafts !== undefined) {
      const drafts = z.array(composerDraftSchema).max(100).parse(rawDrafts);
      // A combined transaction is an ordering boundary for selection-only coalescing.
      this.pendingActivation = undefined;
      await this.vault.commitComposer(state => {
        if (id && !state.threads.some(thread => thread.id === id)) throw new Error('This conversation no longer exists.');
        for (const draft of drafts) this.applyDraft(state, draft);
        state.activeThreadId = id;
      });
      return;
    }
    const temporary = id ? this.vault.thread(id)?.temporary === true : false;
    return new Promise<void>((resolve, reject) => {
      const request = { id, resolve, reject };
      if (this.pendingActivation?.temporary === temporary) { this.pendingActivation.requests.push(request); return; }
      const batch = { requests: [request], temporary }; this.pendingActivation = batch;
      // Queue immediately to preserve ordering with sends, backups and other updates.
      // Choices arriving before this transaction begins share its latest durable selection.
      void this.vault.commitComposer(state => {
        if (this.pendingActivation === batch) this.pendingActivation = undefined;
        const valid = batch.requests.filter(item => {
          if (item.id && !state.threads.some(thread => thread.id === item.id)) { item.reject(new Error('This conversation no longer exists.')); return false; }
          return true;
        });
        if (valid.length) state.activeThreadId = valid.at(-1)!.id;
      }).then(() => {
        if (this.pendingActivation === batch) this.pendingActivation = undefined;
        for (const item of batch.requests) item.resolve();
      }, error => {
        if (this.pendingActivation === batch) this.pendingActivation = undefined;
        for (const item of batch.requests) item.reject(error);
      });
    });
  }
}
