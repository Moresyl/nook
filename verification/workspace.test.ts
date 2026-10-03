import { describe, expect, it } from 'vitest';
import { emptyWorkspace, providerSchema, searchThreads, submitSchema, threadMarkdown, workspaceSchema } from '../contracts/workspace';
import { provider, sampleThread } from './fixtures';

describe('workspace contracts', () => {
  it('creates a fresh valid workspace for each invocation', () => {
    const first = emptyWorkspace(); first.assistants.length = 0;
    expect(emptyWorkspace().assistants).toHaveLength(3);
    expect(workspaceSchema.parse(emptyWorkspace()).schemaVersion).toBe(1);
  });
  it('rejects invalid endpoints, oversized messages, and unsupported data versions', () => {
    expect(providerSchema.safeParse({ ...provider, endpoint: 'file:///secret' }).success).toBe(false);
    expect(submitSchema.safeParse({ providerId: 'x', model: 'x', text: '  ' }).success).toBe(false);
    expect(submitSchema.safeParse({ providerId: 'x', model: 'x', text: 'x'.repeat(256_001) }).success).toBe(false);
    expect(workspaceSchema.safeParse({ ...emptyWorkspace(), schemaVersion: 99 }).success).toBe(false);
  });
  it('searches message contents, combines terms, ignores case, and ranks pinned threads first', () => {
    const one = sampleThread({ id: 'one', title: 'Research', updatedAt: 20, messages: [{ id: 'm', role: 'assistant', content: 'TypeScript notes', status: 'complete', attachments: [], createdAt: 1 }] });
    const two = sampleThread({ id: 'two', title: 'Research TypeScript', pinned: true, updatedAt: 1 });
    expect(searchThreads([one, two], ' RESEARCH typescript ').map((thread) => thread.id)).toEqual(['two', 'one']);
    expect(searchThreads([one, two], 'missing')).toEqual([]);
    expect(searchThreads([one, sampleThread({ id: 'recent', updatedAt: 40 })], '')[0].id).toBe('recent');
  });
  it('exports actual message contents and attachment names as Markdown', () => {
    const output = threadMarkdown(sampleThread({ messages: [
      { id: 'u', role: 'user', content: 'Review this', createdAt: 1, status: 'complete', attachments: [{ id: 'f', name: 'notes.txt', content: 'private note' }] },
      { id: 'a', role: 'assistant', content: 'Done', createdAt: 2, status: 'complete', attachments: [] },
    ] }));
    expect(output).toContain('## You\n\nReview this');
    expect(output).toContain('## Qiyao\n\nDone');
    expect(output).toContain('Attachments: notes.txt');
    expect(output).not.toContain('private note');
  });
});
