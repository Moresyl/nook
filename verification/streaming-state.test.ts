import { describe, expect, it } from 'vitest';
import { mergeStreamingState } from '../contracts/streaming-state';
import { emptyWorkspace, type Message } from '../contracts/workspace';
import { sampleThread } from './fixtures';

const reply: Message = { id: 'reply', role: 'assistant', content: 'one: PARTIAL', attachments: [], createdAt: 1, status: 'running' };
const workspace = (message: Message = reply, id = 'thread') => ({ ...emptyWorkspace(), threads: [sampleThread({ id, messages: [message] })] });
describe('streaming workspace updates', () => {
  it('retains streamed prefixes in delayed workspace and checkpoint responses while applying other saved changes', () => {
    const current = workspace(); const next = workspace({ ...reply, content: '', error: 'Saved metadata' }); next.preferences.theme = 'dark'; next.threads[0].title = 'Renamed';
    const before = structuredClone({ current, next }); const result = mergeStreamingState(current, next)!;
    expect(result.threads[0]).toMatchObject({ title: 'Renamed', messages: [{ content: 'one: PARTIAL', error: 'Saved metadata', status: 'running' }] }); expect(result.preferences.theme).toBe('dark');
    expect({ current, next }).toEqual(before);
    expect(mergeStreamingState(current, workspace({ ...reply, content: 'one: ' }))!.threads[0].messages[0].content).toBe(reply.content);
  });
  it('accepts new and different text, authoritative terminal saves and manual edits', () => {
    const current = workspace();
    for (const message of [{ ...reply, content: `${reply.content}: finished` }, { ...reply, content: 'Different' }, { ...reply }, { ...reply, content: '', status: 'error' as const }, { ...reply, content: 'Edited', status: 'complete' as const }, { ...reply, content: '', status: 'stopped' as const }]) {
      const next = workspace(message); expect(mergeStreamingState(current, next)).toBe(next);
    }
    const edited = workspace({ ...reply, content: 'Manual edit', status: 'complete' }); expect(mergeStreamingState(workspace({ ...reply, status: 'complete' }), edited)).toBe(edited);
  });
  it('does not revive a terminal reply from a stale running response', () => {
    for (const status of ['complete', 'error', 'stopped'] as const) {
      const current = workspace({ ...reply, status, content: 'Final authoritative value' }); const next = workspace({ ...reply, content: '' });
      expect(mergeStreamingState(current, next)!.threads[0].messages[0]).toEqual(current.threads[0].messages[0]);
    }
  });
  it('honors deletion, retry identity, new threads, user edits and explicit state reset', () => {
    const current = workspace();
    const deleted = emptyWorkspace(); expect(mergeStreamingState(current, deleted)).toBe(deleted);
    const missing = workspace(); missing.threads[0].messages = []; expect(mergeStreamingState(current, missing)).toBe(missing);
    const retry = workspace({ ...reply, id: 'new-reply', content: '' }); expect(mergeStreamingState(current, retry)).toBe(retry);
    const another = workspace({ ...reply, content: '' }, 'new-thread'); expect(mergeStreamingState(current, another)).toBe(another);
    const role = workspace({ ...reply, role: 'user', content: '' }); expect(mergeStreamingState(current, role)).toBe(role);
    const user = workspace({ ...reply, role: 'user' }); const next = workspace({ ...reply, content: '' }); expect(mergeStreamingState(user, next)).toBe(next);
    expect(mergeStreamingState(null, current)).toBe(current); expect(mergeStreamingState(current, null)).toBeNull(); expect(mergeStreamingState(null, null)).toBeNull();
  });
  it('matches message IDs inside each owner and leaves unrelated threads and messages intact', () => {
    const current = workspace(); const next = workspace({ ...reply, content: '' }); next.threads[0].messages.push({ ...reply, id: 'another', content: 'Other reply' });
    const other = sampleThread({ id: 'other', messages: [{ ...reply, content: '' }] }); next.threads.push(other);
    const result = mergeStreamingState(current, next)!;
    expect(result.threads[0].messages[0].content).toBe(reply.content); expect(result.threads[0].messages[1]).toBe(next.threads[0].messages[1]); expect(result.threads[1]).toBe(other);
  });
});
