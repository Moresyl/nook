import type { Message } from './workspace';

export type MessageMarker = { id: string; number: number; preview: string };
export type TextMatch = { start: number; end: number };

export function messageMarkers(messages: Message[]): MessageMarker[] {
  return messages.filter((message) => message.role === 'user').map((message, index) => {
    const text = message.content.trim().replace(/\s+/gu, ' ');
    return { id: message.id, number: index + 1, preview: text.slice(0, (text.codePointAt(159) ?? 0) > 0xffff ? 159 : 160) || message.attachments[0]?.name || '空白消息' };
  });
}

export function messageMarkerIndex(count: number, current: number, key: string): number {
  if (count <= 0) return -1;
  const index = Math.max(0, Math.min(count - 1, current));
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowUp') return Math.max(0, index - 1);
  if (key === 'ArrowDown') return Math.min(count - 1, index + 1);
  return index;
}

export function chatTextMatches(text: string, query: string): TextMatch[] {
  if (query.length > 512) throw new Error('Chat search exceeds 512 characters.');
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(text.matchAll(pattern), (match) => ({ start: match.index, end: match.index + match[0].length }));
}
