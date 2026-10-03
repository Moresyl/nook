import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { appendMessageQuote, conversationHistory, conversationRevision } from '../contracts/conversations';
import { submitSchema, type Message } from '../contracts/workspace';
import { request, sampleThread } from './fixtures';

const message: Message = { id: 'user', role: 'user', content: 'First\r\nSecond', createdAt: 1, status: 'complete', attachments: [{ id: 'file', name: 'note.txt', content: 'Evidence' }] };
describe('conversation revisions and quoted drafts', () => {
  it('normalizes streamed/persisted key order and detects changes to message, attachment and execution evidence', async () => {
    const thread = sampleThread({ messages: [message] }); const revision = await conversationRevision(thread);
    expect(revision).toBe(createHash('sha256').update(conversationHistory(thread)).digest('hex'));
    const reordered = { attachments: message.attachments, status: message.status, createdAt: message.createdAt, content: message.content, role: message.role, id: message.id };
    expect(await conversationRevision({ ...thread, title: 'Renamed', updatedAt: 20, messages: [reordered] })).toBe(revision);
    for (const change of [{ content: 'Changed' }, { status: 'stopped' as const }, { attachments: [{ ...message.attachments[0], content: 'Changed file' }] }, { activities: [{ id: 'call', name: 'read_file', input: '{}', output: 'Evidence', status: 'complete' as const, startedAt: 1 }] }]) expect(await conversationRevision({ ...thread, messages: [{ ...message, ...change }] })).not.toBe(revision);
  });
  it('keeps the existing draft, quotes selected or complete text and includes blank lines in the quote', () => {
    expect(appendMessageQuote('Keep my draft', message)).toBe('Keep my draft\n\n引用你的消息：\n> First\n> Second\n\n');
    expect(appendMessageQuote('', { ...message, role: 'assistant' }, 'Second')).toBe('引用助手回复：\n> Second\n\n');
    expect(appendMessageQuote('', { ...message, content: 'One\n\nTwo' }, '  ')).toContain('> One\n> \n> Two');
  });
  it('rejects empty text and excessive combined content without changing a draft', () => {
    expect(() => appendMessageQuote('Keep', { ...message, content: '  ' })).toThrow('no text');
    expect(() => appendMessageQuote('x'.repeat(255_990), message)).toThrow('256 KB');
    expect(appendMessageQuote('', { ...message, content: 'x'.repeat(300_000) }, 'Short selection')).toContain('Short selection');
  });
  it('requires an existing conversation and a bounded revision for replay requests', () => {
    const replay = { messageId: 'user', revision: 'a'.repeat(64), action: 'edit' };
    expect(submitSchema.safeParse({ ...request, replay }).success).toBe(false);
    expect(submitSchema.safeParse({ ...request, threadId: 'thread', replay }).success).toBe(true);
    for (const change of [{ revision: 'bad' }, { action: 'delete' }, { extra: true }]) expect(submitSchema.safeParse({ ...request, threadId: 'thread', replay: { ...replay, ...change } }).success).toBe(false);
  });
});
