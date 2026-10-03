import { randomUUID } from 'node:crypto';
import type { Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export function startTemporaryChat(vault: WorkspaceVault): Promise<Workspace> {
  return vault.update((state) => {
    if (state.threads.length >= 10_000) throw new Error('Conversation history has reached 10,000 conversations. Delete an unused conversation before starting another.');
    const now = Date.now(); const id = randomUUID();
    state.threads.push({ id, title: '临时聊天', temporary: true, model: state.preferences.defaultModel, providerId: state.preferences.defaultProviderId,
      pinned: false, archived: false, createdAt: now, updatedAt: now, messages: [] });
    state.activeThreadId = id;
  });
}
