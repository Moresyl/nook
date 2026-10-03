import { z } from 'zod';
import { composerDraftSchema } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export class ComposerDrafts {
  constructor(private readonly vault: WorkspaceVault) {}

  async save(raw: unknown): Promise<void> {
    const draft = composerDraftSchema.parse(raw);
    await this.vault.update((state) => {
      if (draft.threadId && !state.threads.some((thread) => thread.id === draft.threadId)) throw new Error('This conversation no longer exists. Its draft cannot be saved.');
      if (draft.assistantId && !state.assistants.some((assistant) => assistant.id === draft.assistantId)) delete draft.assistantId;
      const index = state.composerDrafts.findIndex((item) => item.threadId === draft.threadId);
      if (!draft.text.length && !draft.attachments.length) { if (index >= 0) state.composerDrafts.splice(index, 1); }
      else if (index < 0) { if (state.composerDrafts.length >= 100) throw new Error('Conversation drafts are limited to 100 owners. Send or clear an existing draft first.'); state.composerDrafts.push(draft); }
      else state.composerDrafts[index] = draft;
      if (Buffer.byteLength(JSON.stringify(state.composerDrafts), 'utf8') > 32_000_000) throw new Error('Conversation drafts exceed 32 MB. Send or clear an existing draft before saving more.');
    });
  }

  async activate(raw?: unknown): Promise<void> {
    const id = z.string().min(1).max(128).optional().parse(raw);
    await this.vault.update((state) => {
      if (id && !state.threads.some((thread) => thread.id === id)) throw new Error('This conversation no longer exists.');
      state.activeThreadId = id;
    });
  }
}
