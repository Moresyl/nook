import type { Thread } from './workspace';

export type ConversationBranch = { thread: Thread; depth: number; parentId?: string; parentMissing: boolean; cycleRoot: boolean };

export function conversationBranches(threads: Thread[], currentThreadId: string): ConversationBranch[] {
  if (threads.length > 10_000) throw new Error('Conversation history exceeds the 10,000 conversation limit.');
  const byId = new Map<string, Thread>(); const children = new Map<string, Thread[]>();
  for (const thread of threads) {
    if (byId.has(thread.id)) throw new Error('Conversation history contains duplicate conversation IDs.');
    byId.set(thread.id, thread);
    const parent = thread.forkedFrom?.threadId;
    if (parent !== undefined) { const siblings = children.get(parent) ?? []; siblings.push(thread); children.set(parent, siblings); }
  }
  if (!byId.has(currentThreadId)) return [];
  const visited = new Set<string>(); const family: Thread[] = []; const pending = [currentThreadId];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index]; if (visited.has(id)) continue; visited.add(id);
    const thread = byId.get(id);
    if (thread) { family.push(thread); if (thread.forkedFrom) pending.push(thread.forkedFrom.threadId); }
    for (const child of children.get(id) ?? []) pending.push(child.id);
  }
  const order = (left: Thread, right: Thread) => left.createdAt - right.createdAt || left.id.localeCompare(right.id);
  family.sort(order);
  const parents = new Map<string, string>(); const cycleRoots = new Set<string>(); const complete = new Set<string>();
  for (const thread of family) if (thread.forkedFrom && byId.has(thread.forkedFrom.threadId)) parents.set(thread.id, thread.forkedFrom.threadId);
  for (const thread of family) {
    const path: Thread[] = []; const positions = new Map<string, number>(); let next: Thread | undefined = thread;
    while (next && !complete.has(next.id) && !positions.has(next.id)) {
      positions.set(next.id, path.length); path.push(next);
      const parent = parents.get(next.id); next = parent === undefined ? undefined : byId.get(parent);
    }
    if (next && positions.has(next.id)) { const root = path.slice(positions.get(next.id)).sort(order)[0]; parents.delete(root.id); cycleRoots.add(root.id); }
    for (const item of path) complete.add(item.id);
  }
  const descendants = new Map<string, Thread[]>(); const roots: Thread[] = [];
  for (const thread of family) {
    const parent = parents.get(thread.id);
    if (parent === undefined) roots.push(thread);
    else { const siblings = descendants.get(parent) ?? []; siblings.push(thread); descendants.set(parent, siblings); }
  }
  const stack = roots.reverse().map((thread) => ({ thread, depth: 0 })); const result: ConversationBranch[] = [];
  while (stack.length) {
    const { thread, depth } = stack.pop()!;
    result.push({ thread, depth, parentId: parents.get(thread.id), parentMissing: Boolean(thread.forkedFrom && !byId.has(thread.forkedFrom.threadId)), cycleRoot: cycleRoots.has(thread.id) });
    const items = descendants.get(thread.id) ?? [];
    for (let index = items.length - 1; index >= 0; index--) stack.push({ thread: items[index], depth: depth + 1 });
  }
  return result;
}
