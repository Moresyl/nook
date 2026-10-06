import { describe, expect, it } from 'vitest';
import { applyQuickChatEvent, mergeQuickChatThread } from '../contracts/quick-chat-stream';
import { sampleThread } from './fixtures';
const thread = () => sampleThread({ id: 'quick', messages: [{ id: 'reply', role: 'assistant', content: 'Live', status: 'running', attachments: [], createdAt: 1 }] });
describe('quick-chat streamed state', () => {
  it('keeps newer output and completed replies when a late snapshot arrives, while respecting a changed conversation', () => {
    const current = thread(), late = thread(); late.messages[0].content = 'Li';
    expect(mergeQuickChatThread(current, late)?.messages[0].content).toBe('Live');
    current.messages[0].status = 'complete'; expect(mergeQuickChatThread(current, late)?.messages[0].status).toBe('complete');
    const fresh = thread(); fresh.messages[0].content = 'Replacement'; fresh.messages[0].status = 'complete';
    expect(mergeQuickChatThread(current, fresh)).toEqual(fresh);
    expect(mergeQuickChatThread(current, sampleThread({ id: 'second' }))?.id).toBe('second');
    expect(mergeQuickChatThread(undefined, current)).toBe(current); expect(mergeQuickChatThread(current, undefined)).toBeUndefined();
  });
  it('applies live text and tool state only to the correct running message, retaining immutable prior snapshots', () => {
    const current = thread();
    const appended = applyQuickChatEvent(current, { threadId: 'quick', messageId: 'reply', delta: ' text' });
    expect(appended?.messages[0].content).toBe('Live text'); expect(current.messages[0].content).toBe('Live');
    expect(applyQuickChatEvent(current, { threadId: 'other', messageId: 'reply', delta: 'Foreign' })).toBe(current);
    expect(applyQuickChatEvent(undefined, { threadId: 'quick', messageId: 'reply' })).toBeUndefined();
    const activity = { id: 'tool', name: 'read_file', input: '{}', status: 'complete' as const, startedAt: 1, output: 'Evidence' };
    const withTool = applyQuickChatEvent(appended, { threadId: 'quick', messageId: 'reply', activity });
    expect(withTool?.messages[0].activities).toEqual([activity]);
    const invocation = { round: 0, providerId: 'local', providerName: 'Local', providerKind: 'ollama' as const, model: 'test-model', destination: 'http://localhost:11434/v1', startedAt: 1, status: 'running' as const };
    const withUsage = applyQuickChatEvent(withTool, { threadId: 'quick', messageId: 'reply', invocation });
    expect(withUsage?.messages[0].invocations).toEqual([invocation]);
    expect(applyQuickChatEvent(current, { threadId: 'quick', messageId: 'missing', delta: 'Ignored' })?.messages).toEqual(current.messages);
  });
  it('keeps terminal messages unchanged by late deltas and accepts authoritative replies and full owner events', () => {
    const current = thread(), message = { ...current.messages[0], content: 'Done', status: 'complete' as const };
    const complete = applyQuickChatEvent(current, { threadId: 'quick', messageId: 'reply', message });
    expect(applyQuickChatEvent(complete, { threadId: 'quick', messageId: 'reply', delta: 'Late' })?.messages[0]).toEqual(message);
    expect(applyQuickChatEvent(current, { threadId: 'quick', messageId: 'reply', thread: complete })?.messages[0]).toEqual(message);
  });
  it('replaces the matching activity and model round while preserving other tools and ordering every round', () => {
    const current = thread(); const activity = { id: 'one', name: 'read_file', input: '{}', output: '', status: 'running' as const, startedAt: 1 };
    current.messages[0].activities = [activity, { ...activity, id: 'other' }];
    const invocation = { round: 1, providerId: 'local', providerName: 'Local', providerKind: 'ollama' as const, model: 'test-model', destination: 'http://localhost:11434/v1', startedAt: 1, status: 'running' as const };
    current.messages[0].invocations = [{ ...invocation, round: 2 }, invocation, { ...invocation, round: 0 }];
    const next = applyQuickChatEvent(current, { threadId: 'quick', messageId: 'reply', activity: { ...activity, output: 'Evidence', status: 'complete' }, invocation: { ...invocation, status: 'complete' } });
    expect(next?.messages[0].activities?.map(item => [item.id, item.status])).toEqual([['other', 'running'], ['one', 'complete']]);
    expect(next?.messages[0].invocations?.map(item => [item.round, item.status])).toEqual([[0, 'running'], [1, 'complete'], [2, 'running']]);
    expect(current.messages[0].activities?.[0].status).toBe('running'); expect(current.messages[0].invocations?.[0].round).toBe(2);
  });
});
