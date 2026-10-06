import type { QuickChatEvent } from './quick-chat';
import type { Thread } from './workspace';

/** A late load must not replace newer streamed text or an acknowledged terminal reply. */
export function mergeQuickChatThread(current: Thread | undefined, next: Thread | undefined): Thread | undefined {
  if (!current || !next || current.id !== next.id) return next;
  const previous = new Map(current.messages.map(message => [message.id, message]));
  return { ...next, messages: next.messages.map(message => {
    const prior = previous.get(message.id);
    if (!prior || message.role !== 'assistant' || message.status !== 'running') return message;
    if (prior.status !== 'running') return prior;
    return prior.content.length > message.content.length && prior.content.startsWith(message.content) ? { ...message, content: prior.content } : message;
  }) };
}
export function applyQuickChatEvent(current: Thread | undefined, event: QuickChatEvent): Thread | undefined {
  if (event.thread) return mergeQuickChatThread(current, event.thread);
  if (!current || current.id !== event.threadId) return current;
  return { ...current, messages: current.messages.map(message => {
    if (message.id !== event.messageId) return message;
    if (event.message) return event.message;
    if (message.status !== 'running') return message;
    const activities = event.activity ? [...(message.activities ?? []).filter(item => item.id !== event.activity!.id), event.activity] : message.activities;
    const invocations = event.invocation ? [...(message.invocations ?? []).filter(item => item.round !== event.invocation!.round), event.invocation].sort((one, two) => one.round - two.round) : message.invocations;
    return { ...message, activities, invocations, content: message.content + (event.delta ?? '') };
  }) };
}
