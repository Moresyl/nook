import { branchReorderSchema, conversationBranchPeers, conversationBranches } from '../../contracts/conversation-branches';
import type { Workspace } from '../../contracts/workspace';
import type { WorkspaceVault } from './vault';

export function reorderConversationBranch(vault: WorkspaceVault, raw: unknown): Promise<Workspace> {
  const input = branchReorderSchema.parse(raw);
  return vault.update((state) => {
    const nodes = conversationBranches(state.threads, input.threadId);
    if (!nodes.length) throw new Error('This conversation no longer exists. Refresh the branch list.');
    const peers = conversationBranchPeers(nodes, input.threadId);
    if (input.direction === 'reset') { for (const peer of peers) delete peer.thread.branchOrder; return; }
    const index = peers.findIndex((node) => node.thread.id === input.threadId);
    const target = index + (input.direction === 'up' ? -1 : 1);
    if (target < 0 || target >= peers.length) throw new Error('This branch is already at the edge of its level. Refresh the branch list.');
    [peers[index], peers[target]] = [peers[target], peers[index]];
    peers.forEach(({ thread }, order) => { thread.branchOrder = order; });
  });
}
