import { threadMetadataSchema } from '../../contracts/thread-metadata';
import type { Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export function updateThreadMetadata(vault: WorkspaceVault, raw: unknown, assertIdle: (id: string) => void): Promise<Workspace> {
  const input = threadMetadataSchema.parse(raw);
  return vault.update(state => {
    const matches = state.threads.filter(thread => thread.id === input.id);
    if (matches.length !== 1) throw new Error('The conversation is missing or its identifier is duplicated. Refresh and try again.');
    assertIdle(input.id);
    const thread = matches[0];
    if (thread.messages.some(message => message.status === 'running')) throw new Error('Wait for the conversation to finish before changing its details.');
    let changed = false;
    if (input.title !== undefined && input.title !== thread.title) { thread.title = input.title; changed = true; }
    if (input.pinned !== undefined && input.pinned !== thread.pinned) { thread.pinned = input.pinned; changed = true; if (!input.pinned) delete thread.pinOrder; }
    if (input.archived !== undefined && input.archived !== thread.archived) { thread.archived = input.archived; changed = true; }
    if (changed) thread.updatedAt = Date.now();
  });
}
