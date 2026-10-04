import type { Message, Workspace } from './workspace';

export function mergeStreamingState(current: Workspace | null, next: Workspace | null): Workspace | null {
  if (!current || !next) return next;
  const previous = new Map(current.threads.map((thread) => [thread.id, thread]));
  let changed = false;
  const threads = next.threads.map((thread) => {
    if (!thread.messages.some((message) => message.role === 'assistant' && message.status === 'running')) return thread;
    const before = previous.get(thread.id);
    if (!before) return thread;
    const messages = new Map(before.messages.map((message) => [message.id, message]));
    let threadChanged = false;
    const merged = thread.messages.map((message): Message => {
      const prior = messages.get(message.id);
      if (!prior || prior.role !== 'assistant' || message.role !== 'assistant' || message.status !== 'running') return message;
      if (prior.status !== 'running') { threadChanged = true; return prior; }
      if (prior.content.length <= message.content.length || !prior.content.startsWith(message.content)) return message;
      threadChanged = true;
      return { ...message, content: prior.content };
    });
    if (!threadChanged) return thread;
    changed = true;
    return { ...thread, messages: merged };
  });
  return changed ? { ...next, threads } : next;
}
