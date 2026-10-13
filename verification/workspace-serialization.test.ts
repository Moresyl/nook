import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, workspaceSchema, type Workspace } from '../contracts/workspace';
import { persistentWorkspace } from '../contracts/temporary-conversations';
import { sameThreadEncoding, WorkspaceSerialization } from '../desktop/services/workspace-serialization';
import { sampleThread } from './fixtures';

const canonical = (state: Workspace) => Buffer.from(JSON.stringify(state, null, 2), 'utf8');
function populated(): Workspace {
  return workspaceSchema.parse({ ...emptyWorkspace(), threads: [sampleThread({ id: '__proto__', title: '历史 中文 😀', messages: [
    { id: 'message', role: 'user', content: '中文 😀\n\t"\\\u2028\u2029\ud800', status: 'complete', attachments: [], createdAt: 1 },
  ] }), sampleThread({ id: 'second' })], activeThreadId: '__proto__', notes: [{ id: 'note', title: 'Note', content: '\nNested', createdAt: 1 }] });
}
afterEach(() => { vi.restoreAllMocks(); });
describe('cached canonical workspace serialization', () => {
  it('compares exact thread encoding without serializing equal Unicode history and detects changed nested values', () => {
    const original = populated().threads[0], copy = structuredClone(original);
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(sameThreadEncoding(original, copy)).toBe(true); expect(stringify).not.toHaveBeenCalled();
    copy.messages[0].content += 'Changed'; expect(sameThreadEncoding(original, copy)).toBe(false);
  });
  it.each(['thread', 'message'] as const)('distinguishes equal values with changed JSON key order at the %s level', level => {
    const original = populated().threads[0], copy = structuredClone(original);
    if (level === 'thread') expect(sameThreadEncoding(original, Object.fromEntries(Object.entries(copy).reverse()) as typeof copy)).toBe(false);
    else { copy.messages[0] = Object.fromEntries(Object.entries(copy.messages[0]).reverse()) as typeof copy.messages[number]; expect(sameThreadEncoding(original, copy)).toBe(false); }
  });
  it.each(['thread', 'message'] as const)('retains exact JSON property order when the %s has equal values in a different key order', (level) => {
    const state = populated(); const serialization = new WorkspaceSerialization(); serialization.serialize(state);
    if (level === 'thread') state.threads[0] = Object.fromEntries(Object.entries(state.threads[0]).reverse()) as typeof state.threads[number];
    else state.threads[0].messages[0] = Object.fromEntries(Object.entries(state.threads[0].messages[0]).reverse()) as typeof state.threads[number]['messages'][number];
    expect(serialization.serialize(state)).toEqual(canonical(state));
  });
  it('matches exact existing JSON bytes for empty and populated Unicode workspaces', () => {
    const serialization = new WorkspaceSerialization();
    for (const state of [emptyWorkspace(), populated()]) {
      const expected = canonical(state);
      expect(serialization.serialize(state)).toEqual(expected);
      expect(serialization.serialize(structuredClone(state))).toEqual(expected);
    }
  });
  it('does not re-encode unchanged large history when a separate conversation changes', () => {
    const state = populated(); state.threads[0].messages[0].content = '大工作区 \n😀'.repeat(50_000);
    const serialization = new WorkspaceSerialization(); serialization.serialize(state);
    const next = structuredClone(state); next.threads[1].title = 'Changed';
    const expected = canonical(next);
    const stringify = vi.spyOn(JSON, 'stringify');
    expect(serialization.serialize(next).equals(expected)).toBe(true);
    expect(stringify.mock.calls.some(([value]) => value && typeof value === 'object' && 'id' in value && value.id === '__proto__')).toBe(false);
  });
  it('keeps cached values and bytes independent of mutated input and returned buffers', () => {
    const state = populated(); const serialization = new WorkspaceSerialization();
    serialization.serialize(state).fill(0);
    expect(serialization.serialize(state)).toEqual(canonical(state));
    state.threads[0].messages[0].content = 'Changed in place'; state.threads[0].title = 'Renamed';
    state.threads[0].messages.push({ id: 'reply', role: 'assistant', content: 'PARTIAL', status: 'running', attachments: [], createdAt: 2 });
    expect(serialization.serialize(state)).toEqual(canonical(state));
    state.threads[0].messages.at(-1)!.status = 'complete';
    expect(serialization.serialize(state)).toEqual(canonical(state));
  });
  it('preserves duplicate IDs, ordering, deletion and restoration without stale history', () => {
    const state = populated(); state.threads.push(sampleThread({ id: '__proto__', title: 'Different duplicate' }));
    const serialization = new WorkspaceSerialization(); expect(serialization.serialize(state)).toEqual(canonical(state));
    const previous = structuredClone(state); state.threads.reverse();
    expect(serialization.serialize(state)).toEqual(canonical(state));
    state.threads.length = 0; delete state.activeThreadId;
    expect(serialization.serialize(state)).toEqual(canonical(state));
    expect(serialization.serialize(previous)).toEqual(canonical(previous));
  });
  it('preserves optional undefined fields and recovers after unsuccessful serialization', () => {
    const state = populated(); state.activeThreadId = undefined; state.threads[0].assistantId = undefined;
    const serialization = new WorkspaceSerialization(); const expected = canonical(state);
    expect(serialization.serialize(state)).toEqual(expected);
    const invalid = structuredClone(state); (invalid.notes[0] as unknown as { content: bigint }).content = 1n;
    expect(() => serialization.serialize(invalid)).toThrow();
    expect(serialization.serialize(state)).toEqual(expected);
  });
  it('keeps temporary histories excluded while retaining the prior persistent selection', () => {
    const state = populated(); const serialization = new WorkspaceSerialization();
    const original = canonical(state); serialization.serialize(state);
    state.threads.push(sampleThread({ id: 'temporary', temporary: true, title: 'Private temporary' })); state.activeThreadId = 'temporary';
    const persistent = persistentWorkspace(state, '__proto__');
    expect(serialization.serialize(persistent)).toEqual(original);
    expect(serialization.serialize(persistent).toString('utf8')).not.toContain('Private temporary');
  });
});
