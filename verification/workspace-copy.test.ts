import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkspace, workspaceSchema } from '../contracts/workspace';
import { copyWorkspace } from '../desktop/services/workspace-copy';
import { sampleThread } from './fixtures';

afterEach(() => { vi.restoreAllMocks(); });
describe('detached workspace record copies', () => {
  it('preserves complete validated records, Unicode, optional fields and exact property order', () => {
    const state = workspaceSchema.parse({ ...emptyWorkspace(), threads: [sampleThread({ id: '__proto__', messages: [
      { id: 'message', role: 'user', content: '中文😀\n\ud800', status: 'complete', attachments: [], createdAt: 1 },
    ] })], activeThreadId: undefined });
    const expected = structuredClone(state); const copied = copyWorkspace(state);
    expect(copied).toEqual(expected); expect(Object.keys(copied)).toEqual(Object.keys(expected));
    expect(Object.hasOwn(copied, 'activeThreadId')).toBe(true);
    expect(JSON.stringify(copied)).toBe(JSON.stringify(expected));
    copied.threads[0].messages[0].content = 'External mutation'; copied.preferences.theme = 'dark'; copied.threads.push(sampleThread());
    expect(state).toEqual(expected);
    state.threads[0].title = 'Later mutation'; expect(copied.threads[0].title).toBe(expected.threads[0].title);
  });
  it('never serializes the whole workspace or accumulated histories in one clone', () => {
    const state = emptyWorkspace(); state.threads = Array.from({ length: 20 }, (_, index) => sampleThread({ id: String(index), messages: [
      { id: 'large', role: 'user', content: '中文😀'.repeat(16_000), status: 'complete', attachments: [], createdAt: 1 },
    ] }));
    const original = structuredClone; const inputs: unknown[] = [];
    vi.spyOn(globalThis, 'structuredClone').mockImplementation(value => {
      if (value === state || value === state.threads) throw new Error('Whole-workspace serializer allocation');
      inputs.push(value); return original(value);
    });
    expect(copyWorkspace(state)).toEqual(state);
    expect(inputs.filter(value => state.threads.includes(value as typeof state.threads[number]))).toHaveLength(20);
  });
  it('reports a record clone failure without mutating its source and permits a later retry', () => {
    const state = emptyWorkspace(); state.threads = [sampleThread()]; const before = structuredClone(state);
    vi.spyOn(globalThis, 'structuredClone').mockImplementationOnce(() => { throw new Error('Record clone failed'); });
    expect(() => copyWorkspace(state)).toThrow('Record clone failed'); expect(state).toEqual(before);
    expect(copyWorkspace(state)).toEqual(before);
  });
});
