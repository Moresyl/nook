import { describe, expect, it } from 'vitest';
import { conversationBranches } from '../contracts/conversation-branches';
import { sampleThread } from './fixtures';
import type { Thread } from '../contracts/workspace';

const branch = (id: string, parent: string, changes: Partial<Thread> = {}) => sampleThread({ id, forkedFrom: { threadId: parent, messageId: 'origin', kind: 'branch' }, ...changes });
const shape = (threads: Thread[], current: string) => conversationBranches(threads, current).map(({ thread, depth, parentId, parentMissing, cycleRoot }) => ({ id: thread.id, depth, parentId, parentMissing, cycleRoot }));

describe('complete conversation branch navigation', () => {
  it('returns no invented node for absent or empty history', () => {
    expect(conversationBranches([], 'missing')).toEqual([]); expect(conversationBranches([sampleThread()], 'missing')).toEqual([]);
  });
  it('keeps an independent conversation isolated from other roots', () => {
    expect(shape([sampleThread({ id: 'other' }), sampleThread()], 'thread')).toEqual([{ id: 'thread', depth: 0, parentId: undefined, parentMissing: false, cycleRoot: false }]);
  });
  it('includes ancestors, siblings and descendants in stable chronological preorder', () => {
    const threads = [branch('later', 'root', { createdAt: 4 }), branch('leaf', 'first', { createdAt: 3 }), branch('first', 'root', { createdAt: 2 }), sampleThread({ id: 'root' }), sampleThread({ id: 'unrelated' })];
    const expected = [{ id: 'root', depth: 0, parentId: undefined, parentMissing: false, cycleRoot: false }, { id: 'first', depth: 1, parentId: 'root', parentMissing: false, cycleRoot: false }, { id: 'leaf', depth: 2, parentId: 'first', parentMissing: false, cycleRoot: false }, { id: 'later', depth: 1, parentId: 'root', parentMissing: false, cycleRoot: false }];
    for (const current of ['root', 'first', 'leaf', 'later']) expect(shape(threads, current)).toEqual(expected);
    expect(shape([...threads].reverse(), 'leaf')).toEqual(expected);
  });
  it('retains exact contexts, archived reply/edit paths and their original metadata without mutation', () => {
    const root = sampleThread({ id: 'root', messages: [{ id: 'message', role: 'assistant', content: '<img> {{literal}} 中文😀', status: 'stopped', createdAt: 1, attachments: [{ id: 'file', name: '文档.txt', content: 'ORIGINAL' }] }] });
    const threads = [root, ...(['branch', 'edit', 'reply', 'message'] as const).map((kind) => branch(kind, 'root', { archived: true, forkedFrom: { threadId: 'root', messageId: 'message', kind } }))];
    const before = structuredClone(threads); const nodes = conversationBranches(threads, 'reply'); expect(nodes).toHaveLength(5); expect(nodes[0].thread).toBe(root); expect(nodes.filter((node) => node.thread.archived)).toHaveLength(4); expect(threads).toEqual(before);
  });
  it('keeps surviving siblings linked through a deleted parent and reports only actual missing parents', () => {
    const threads = [branch('b', 'deleted'), branch('a', 'deleted'), branch('leaf', 'a'), branch('other', 'another-deleted')];
    expect(shape(threads, 'leaf')).toEqual([{ id: 'a', depth: 0, parentId: undefined, parentMissing: true, cycleRoot: false }, { id: 'leaf', depth: 1, parentId: 'a', parentMissing: false, cycleRoot: false }, { id: 'b', depth: 0, parentId: undefined, parentMissing: true, cycleRoot: false }]);
  });
  it('breaks a self reference only in the displayed hierarchy and preserves descendants', () => {
    const threads = [branch('self', 'self'), branch('leaf', 'self')]; const before = structuredClone(threads);
    expect(shape(threads, 'leaf')).toEqual([{ id: 'self', depth: 0, parentId: undefined, parentMissing: false, cycleRoot: true }, { id: 'leaf', depth: 1, parentId: 'self', parentMissing: false, cycleRoot: false }]); expect(threads).toEqual(before);
  });
  it('breaks cyclic ancestry at the oldest actual cycle member rather than an older descendant', () => {
    const threads = [branch('descendant', 'b', { createdAt: 0 }), branch('b', 'c', { createdAt: 2 }), branch('c', 'a', { createdAt: 3 }), branch('a', 'b', { createdAt: 1 })];
    expect(shape(threads, 'descendant').map((node) => [node.id, node.depth, node.cycleRoot])).toEqual([['a', 0, true], ['c', 1, false], ['b', 2, false], ['descendant', 3, false]]);
    expect(shape([...threads].reverse(), 'b')).toEqual(shape(threads, 'descendant'));
  });
  it('uses stable ID ordering for equal timestamps and accepts prototype-like identifiers', () => {
    const threads = [branch('constructor', '__proto__'), branch('a', '__proto__'), sampleThread({ id: '__proto__' })];
    expect(shape(threads, 'constructor').map((node) => node.id)).toEqual(['__proto__', 'a', 'constructor']);
  });
  it('retains every node at the actual 10,000-conversation limit without recursive stack overflow', () => {
    const threads = Array.from({ length: 10_000 }, (_, index) => index === 0 ? sampleThread({ id: '0' }) : branch(String(index), String(index - 1), { createdAt: index + 1 }));
    const nodes = conversationBranches(threads, '9999'); expect(nodes).toHaveLength(10_000); expect(nodes[0].thread.id).toBe('0'); expect(nodes.at(-1)).toMatchObject({ depth: 9999, thread: { id: '9999' } });
  });
  it('rejects oversized or ambiguous histories without exposing message content', () => {
    const thread = sampleThread({ title: 'PRIVATE_HISTORY' }); expect(() => conversationBranches([thread, thread], 'thread')).toThrow('duplicate conversation IDs');
    expect(() => conversationBranches(Array.from({ length: 10_001 }, () => thread), 'thread')).toThrow('10,000 conversation limit');
  });
});
