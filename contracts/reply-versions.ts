import type { Message, Thread } from './workspace';

export type ReplyVersion = { threadId: string; message: Message; model: string };
export function nextReplyVersion(threads: Thread[], groupId: string): number {
  let number = 1;
  for (const thread of threads) for (const message of thread.messages) if (message.replyVersion?.groupId === groupId) number = Math.max(number, message.replyVersion.number);
  if (number >= 10_000) throw new Error('This reply has reached the 10,000 version limit. Start a new conversation.');
  return number + 1;
}
export function replyVersions(threads: Thread[], currentThreadId: string): Map<string, ReplyVersion[]> {
  const groups = new Map<string, Map<string, ReplyVersion & { updatedAt: number }>>();
  for (const thread of threads) for (const message of thread.messages) {
    if (message.role !== 'assistant' || !message.replyVersion) continue;
    const id = message.replyVersion.groupId; const group = groups.get(id) ?? new Map(); groups.set(id, group);
    const previous = group.get(message.id);
    if (!previous || thread.id === currentThreadId || previous.threadId !== currentThreadId && thread.updatedAt > previous.updatedAt) group.set(message.id, { threadId: thread.id, message, model: message.invocations?.at(-1)?.model ?? thread.model, updatedAt: thread.updatedAt });
  }
  return new Map([...groups].map(([id, group]) => [id, [...group.values()].sort((a, b) => a.message.replyVersion!.number - b.message.replyVersion!.number || a.message.id.localeCompare(b.message.id)).map(({ updatedAt: _updatedAt, ...version }) => version)]));
}
