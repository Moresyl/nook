import { messageSchema, type Message, type Thread } from './workspace';

// Normalize schema key order so streamed renderer messages and persisted messages agree.
export function conversationHistory(thread: Thread): string {
  return JSON.stringify(thread.messages.map((message) => messageSchema.parse(message)));
}

export async function conversationRevision(thread: Thread): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(conversationHistory(thread)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function appendMessageQuote(draft: string, message: Message, selectedText?: string): string {
  const text = (selectedText?.trim() || message.content.trim()).replaceAll('\r\n', '\n');
  if (!text) throw new Error('This message contains no text to quote.');
  const quote = `${message.role === 'user' ? '引用你的消息' : '引用助手回复'}：\n${text.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  const next = `${draft}${draft ? '\n\n' : ''}${quote}`;
  if (next.length > 256_000) throw new Error('The quoted message and draft exceed 256 KB. Select a shorter passage to quote.');
  return next;
}
