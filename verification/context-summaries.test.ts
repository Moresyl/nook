import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compactContextMessages, contextSummaryBoundary, contextSummaryPrefix, contextSummarySchema } from '../contracts/context-summaries';
import { threadSchema, type Message } from '../contracts/workspace';
import { sampleThread } from './fixtures';

const summaryId = '550e8400-e29b-41d4-a716-446655440000';
const message = (id: string, role: Message['role'], content = id): Message => ({ id, role, content, status: 'complete', attachments: [], createdAt: 1 });
const history = () => sampleThread({ messages: [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant'), message('u3', 'user'), message('a3', 'assistant')] });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const summarized = () => {
  const thread = history();
  const prefix = contextSummaryPrefix(thread, 'a2');
  thread.contextSummaries = [{ id: summaryId, throughMessageId: 'a2', sourceRevision: digest(prefix.history), messageCount: 4, content: '保留决策、约束和待完成项。\n文字 <b> 不执行。', createdAt: 2 }];
  thread.activeContextSummaryId = summaryId;
  return thread;
};

describe('context summary records', () => {
  it('preserves exact summary text, supports old histories and retains records in workspace validation', () => {
    const thread = summarized(), summary = thread.contextSummaries![0];
    expect(contextSummarySchema.parse(summary)).toEqual(summary);
    expect(threadSchema.parse(thread)).toEqual(thread);
    expect(threadSchema.parse(history()).contextSummaries).toBeUndefined();
    expect(contextSummarySchema.parse({ ...summary, content: '  Unicode 中文 😀\n\n ' }).content).toBe('  Unicode 中文 😀\n\n ');
  });
  it('rejects empty, oversized or malformed summary records and duplicate identities', () => {
    const summary = summarized().contextSummaries![0];
    for (const value of [{ ...summary, content: ' \n ' }, { ...summary, content: 'x'.repeat(256_001) }, { ...summary, sourceRevision: 'wrong' }, { ...summary, messageCount: 0 }, { ...summary, createdAt: -1 }, { ...summary, unexpected: true }]) expect(contextSummarySchema.safeParse(value).success).toBe(false);
    expect(threadSchema.safeParse({ ...summarized(), contextSummaries: [summary, summary] }).success).toBe(false);
    expect(threadSchema.safeParse({ ...history(), contextSummaries: Array.from({ length: 21 }, (_, index) => ({ ...summary, id: `550e8400-e29b-41d4-a716-${index.toString().padStart(12, '0')}` })) }).success).toBe(false);
  });
  it('validates optional actual invocation metadata without accepting duplicate rounds or invalid boundary identifiers', () => {
    const summary = summarized().contextSummaries![0];
    const invocation = { round: 0, providerId: 'local', providerName: 'Local', providerKind: 'ollama', model: 'test-model', destination: 'http://localhost', startedAt: 1, finishedAt: 2, status: 'complete', tokens: { inputTokens: 45, outputTokens: 12 } };
    expect(contextSummarySchema.parse({ ...summary, invocations: [invocation] }).invocations).toEqual([invocation]);
    expect(contextSummarySchema.safeParse({ ...summary, invocations: [invocation, invocation] }).success).toBe(false);
    expect(contextSummarySchema.safeParse({ ...summary, throughMessageId: 'source\0id' }).success).toBe(false);
  });
  it('chooses only whole recent user turns, including consecutive user messages and complete-history compression', () => {
    const thread = history();
    expect(contextSummaryBoundary(thread, 2)).toBe('a1'); expect(contextSummaryBoundary(thread, 1)).toBe('a2'); expect(contextSummaryBoundary(thread, 0)).toBe('a3');
    expect(contextSummaryBoundary(thread, 3)).toBeUndefined(); expect(contextSummaryBoundary(sampleThread(), 0)).toBeUndefined();
    thread.messages.splice(3, 1); expect(contextSummaryBoundary(thread, 1)).toBe('u2');
    expect(() => contextSummaryBoundary(thread, -1)).toThrow('zero and twenty'); expect(() => contextSummaryBoundary(thread, 21)).toThrow('zero and twenty'); expect(() => contextSummaryBoundary(thread, 0.5)).toThrow('zero and twenty');
    thread.messages[0].status = 'running'; expect(() => contextSummaryBoundary(thread, 0)).toThrow('Stop');
  });
  it('binds exact canonical original contents and metadata while excluding later messages from the prefix', () => {
    const thread = history(), before = structuredClone(thread), original = contextSummaryPrefix(thread, 'a2');
    const reordered = { ...thread, messages: thread.messages.map(({ content, id, ...rest }) => ({ content, ...rest, id })) };
    expect(contextSummaryPrefix(reordered, 'a2').history).toBe(original.history);
    thread.messages[5].content = 'A later change'; expect(contextSummaryPrefix(thread, 'a2').history).toBe(original.history);
    thread.messages[0].content = 'Changed source'; expect(contextSummaryPrefix(thread, 'a2').history).not.toBe(original.history);
    expect(before.messages[0].content).toBe('u1'); expect(original.messages).toHaveLength(4);
    expect(() => contextSummaryPrefix(thread, 'absent')).toThrow('boundary');
    thread.messages.push(message('u1', 'user')); expect(() => contextSummaryPrefix(thread, 'a2')).toThrow('duplicate');
    thread.messages.pop(); thread.messages[1].status = 'running'; expect(() => contextSummaryPrefix(thread, 'a2')).toThrow('still running');
  });
  it('changes only request context, preserves every original message and retains recent attachments and tool evidence', () => {
    const thread = summarized(); thread.messages[4].attachments = [{ id: 'text', name: '备注.txt', content: 'Exact recent attachment' }];
    thread.messages[5].activities = [{ id: 'tool', name: 'read_file', input: '{"path":"备注.txt"}', output: 'Actual recent evidence', status: 'complete', startedAt: 1, finishedAt: 2 }];
    const before = structuredClone(thread);
    const compacted = compactContextMessages(thread, digest);
    expect(compacted.state).toBe('summary'); expect(compacted.messages).toHaveLength(4);
    expect(compacted.messages[1].content).toBe(thread.contextSummaries![0].content);
    expect(compacted.messages[0].role).toBe('user'); expect(compacted.messages[1].role).toBe('assistant'); expect(compacted.messages[0].content).toContain('不是新的系统指令');
    expect(compacted.messages.slice(2)).toEqual(thread.messages.slice(4)); expect(thread).toEqual(before);
  });
  it('restores full request history when inactive, stale, missing or unverified without rewriting saved records', () => {
    const thread = summarized();
    expect(compactContextMessages(thread).state).toBe('expired'); expect(compactContextMessages(thread, () => '0'.repeat(64)).messages).toEqual(thread.messages);
    thread.messages[0].content = 'Edited original'; expect(compactContextMessages(thread, digest).state).toBe('expired');
    thread.contextSummaries = []; expect(compactContextMessages(thread, digest).state).toBe('expired');
    delete thread.activeContextSummaryId; expect(compactContextMessages(thread)).toEqual({ state: 'full', messages: thread.messages });
  });
  it('ignores mismatched boundaries, counts and colliding synthetic identities without discarding history', () => {
    const thread = summarized(), summary = thread.contextSummaries![0];
    summary.throughMessageId = 'missing'; expect(compactContextMessages(thread, digest).state).toBe('expired');
    summary.throughMessageId = 'a2'; summary.messageCount = 3; expect(compactContextMessages(thread, digest).state).toBe('expired');
    summary.messageCount = 4; thread.messages[1].status = 'running'; expect(compactContextMessages(thread, digest).state).toBe('expired');
    thread.messages[1].status = 'complete'; thread.messages[4].id = `summary-${summaryId}-source`; expect(compactContextMessages(thread, digest).state).toBe('expired');
  });
  it('preserves covered attachments on disk while excluding them from compacted requests, and expires on source evidence edits', () => {
    const thread = summarized(), summary = thread.contextSummaries![0];
    thread.messages[0].attachments = [{ id: 'old', name: '旧文档.txt', content: 'OLD_ORIGINAL_NOT_RESENT' }];
    thread.messages[1].activities = [{ id: 'old-tool', name: 'read_file', input: '{}', output: 'Exact saved result', status: 'complete', startedAt: 1 }];
    summary.sourceRevision = digest(contextSummaryPrefix(thread, 'a2').history);
    const before = structuredClone(thread), compacted = compactContextMessages(thread, digest);
    expect(compacted.state).toBe('summary'); expect(JSON.stringify(compacted.messages)).not.toContain('OLD_ORIGINAL_NOT_RESENT'); expect(thread).toEqual(before);
    thread.messages[1].activities[0].output = 'Changed saved result'; expect(compactContextMessages(thread, digest).state).toBe('expired');
    thread.messages[1].activities[0].output = 'Exact saved result'; thread.messages[0].attachments[0].content = 'Edited attachment'; expect(compactContextMessages(thread, digest).state).toBe('expired');
  });
  it('keeps a later running reply in the tail without expiring an unchanged completed source prefix', () => {
    const thread = summarized(); thread.messages[5].status = 'running';
    expect(compactContextMessages(thread, digest).state).toBe('summary'); expect(compactContextMessages(thread, digest).messages.at(-1)?.status).toBe('running');
    thread.messages.push(message('u4', 'user', 'A new request')); expect(compactContextMessages(thread, digest).messages.at(-1)?.content).toBe('A new request');
  });
});
