import { pinnedReorderSchema } from '../../contracts/pinned-order';
import { searchThreads, type Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export function reorderPinnedThread(vault: WorkspaceVault, raw: unknown): Promise<Workspace> {
  const input = pinnedReorderSchema.parse(raw);
  return vault.update(state => {
    if (new Set(state.threads.map(thread => thread.id)).size !== state.threads.length) throw new Error('Conversation history contains duplicate conversation IDs.');
    const pinned = searchThreads(state.threads.filter(thread => thread.pinned && !thread.archived), '');
    const source = pinned.find(thread => thread.id === input.threadId), target = pinned.find(thread => thread.id === input.targetId);
    if (!source || !target) throw new Error('The pinned conversation list changed. Refresh the list and try again.');
    if (source === target) throw new Error('Choose a different pinned conversation as the destination.');
    const next = pinned.filter(thread => thread !== source);
    next.splice(next.indexOf(target) + (input.position === 'after' ? 1 : 0), 0, source);
    if (next.every((thread, index) => thread === pinned[index])) return;
    next.forEach((thread, index) => { thread.pinOrder = index; });
  });
}
