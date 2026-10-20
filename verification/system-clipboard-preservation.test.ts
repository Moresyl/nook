import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { preserveSystemClipboard } from '../scripts/system-clipboard-preservation.mjs';

const nativeRequire = createRequire(import.meta.url);
const raw = 'electron application/osclipboard;format="Nook verification bytes"';
type Payload = Blob | { title: string; url: string };
type Contents = Record<string, Payload>;
class ClipboardItem {
  readonly values: Contents;
  constructor(data: Record<string, Payload | string>) { this.values = Object.fromEntries(Object.entries(data).map(([type, value]) => [type, typeof value === 'string' ? new Blob([value]) : value])); }
  get types() { return Object.keys(this.values); }
  async getType(type: string) { return this.values[type]; }
}
function fixture(initial: Contents, platform = 'win32') {
  let contents = { ...initial }, readNumber = 0;
  const reads: Map<string, number>[] = [];
  const hooks: { read?: (readNumber: number, type: string) => void; write?: (writeNumber: number) => void } = {};
  const clipboard = {
    read: vi.fn(async () => {
      const number = ++readNumber, counts = new Map<string, number>(); reads.push(counts);
      return Object.keys(contents).length ? [{ types: Object.keys(contents), getType: async (type: string) => {
        counts.set(type, (counts.get(type) ?? 0) + 1); hooks.read?.(number, type);
        return contents[type] ?? new Blob([]);
      } }] : [];
    }),
    write: vi.fn(async (items: ClipboardItem[]) => {
      const next: Contents = {};
      for (const item of items) for (const type of item.types) {
        const value = await item.getType(type);
        next[type] = type === 'text/plain' && value instanceof Blob ? new Blob([(await value.text()).split('\0')[0]]) : value;
      }
      contents = next; hooks.write?.(clipboard.write.mock.calls.length);
    }),
    clear: vi.fn(() => { contents = {}; }),
    has: vi.fn(async (type: string) => type in contents),
    readText: vi.fn(async () => contents['text/plain'] instanceof Blob ? contents['text/plain'].text() : ''),
  };
  const context = { require: (name: string) => name === 'electron' ? { clipboard, ClipboardItem } : nativeRequire(name), Blob, Buffer, process: { platform } };
  return { clipboard, reads, hooks, context, contents: () => contents, replace: (next: Contents) => { contents = next; }, run: () => runInNewContext(`(${preserveSystemClipboard.toString()})()`, context) };
}

describe('native clipboard preservation', () => {
  it('materializes each lazy payload once and restores text, HTML, bookmark and exact binary bytes', async () => {
    const original = { 'text/plain': new Blob(['原始\r\ntext']), 'text/html': new Blob(['<b>原始</b>']), [raw]: new Blob([new Uint8Array([0, 255, 7, 0])]), 'electron application/bookmark': { title: 'Original', url: 'https://example.invalid/' } };
    const state = fixture(original);
    await expect(state.run()).resolves.toMatchObject({ supported: true, emptyPlainTextRoundTrip: true });
    expect(await (state.contents()['text/plain'] as Blob).text()).toBe('原始\r\ntext');
    expect(await (state.contents()['text/html'] as Blob).text()).toBe('<b>原始</b>');
    expect(new Uint8Array(await (state.contents()[raw] as Blob).arrayBuffer())).toEqual(new Uint8Array([0, 255, 7, 0]));
    expect(state.contents()['electron application/bookmark']).toEqual(original['electron application/bookmark']);
    expect(state.reads.every(read => [...read.values()].every(count => count === 1))).toBe(true);
    expect(state.clipboard.write).toHaveBeenCalledTimes(3);
  });
  it('preserves a genuinely empty Windows plain-text format', async () => {
    const state = fixture({ 'text/plain': new Blob([]) });
    await expect(state.run()).resolves.toMatchObject({ emptyPlainTextRoundTrip: true });
    expect(Object.keys(state.contents())).toEqual(['text/plain']);
    expect((state.contents()['text/plain'] as Blob).size).toBe(0);
  });
  it.each([raw, 'electron application/osclipboard;format="image/bmp"', 'text/html', 'image/png'])('rejects an empty or unavailable %s before changing the system clipboard', async type => {
    const original = { 'text/plain': new Blob(['PRIVATE_CLIPBOARD_CONTENT']), [type]: new Blob([]) }, state = fixture(original);
    const error = await state.run().catch((value: Error) => value);
    expect(error.message).toContain('Cannot safely preserve an empty or unavailable non-text Windows clipboard payload:');
    expect(error.message).toContain(JSON.stringify({ item: 0, format: ['text/html', 'image/png'].includes(type) ? type : 'custom', formatSha256: createHash('sha256').update(type).digest('hex'), bytes: 0 }));
    expect(error.message).not.toContain('PRIVATE_CLIPBOARD_CONTENT');
    expect(state.clipboard.write).not.toHaveBeenCalled(); expect(state.clipboard.clear).not.toHaveBeenCalled();
    expect(state.contents()).toEqual(original);
  });
  it('identifies a failing custom format without logging its private name or payload', async () => {
    const type = 'electron application/osclipboard;format="PRIVATE_NAME\nFORGED_LOG"';
    const state = fixture({ [type]: new Blob([]), 'text/plain': new Blob(['PRIVATE_CONTENT']) });
    const error = await state.run().catch((value: Error) => value);
    expect(error.message).toContain(createHash('sha256').update(type).digest('hex'));
    expect(error.message).toContain('"format":"custom"');
    expect(error.message).not.toMatch(/PRIVATE_NAME|FORGED_LOG|PRIVATE_CONTENT|\n/);
    expect(state.clipboard.write).not.toHaveBeenCalled(); expect(state.clipboard.clear).not.toHaveBeenCalled();
    expect(state.reads[0].get('text/plain')).toBeUndefined();
  });
  it('rejects a snapshot mixed with a concurrent external copy without overwriting the new data', async () => {
    const state = fixture({ 'text/plain': new Blob(['first']), 'text/html': new Blob(['<b>first</b>']) });
    const next = { 'text/plain': new Blob(['second']), 'text/html': new Blob(['<b>second</b>']) };
    state.hooks.read = (number, type) => { if (number === 1 && type === 'text/html') state.replace(next); };
    await expect(state.run()).rejects.toThrow('Clipboard changed during snapshot; clipboard was not modified');
    expect(state.clipboard.write).not.toHaveBeenCalled(); expect(state.clipboard.clear).not.toHaveBeenCalled();
    expect(state.contents()).toEqual(next);
  });
  it('retains the strict original restoration assertion when the native writer loses a format', async () => {
    const state = fixture({ 'text/plain': new Blob(['original']), [raw]: new Blob(['binary']) });
    state.hooks.write = number => { if (number === 3) delete state.contents()[raw]; };
    await expect(state.run()).rejects.toThrow('Original clipboard restoration');
  });
  it('restores the original clipboard if a native format becomes unavailable during the empty-text probe', async () => {
    const original = { 'text/plain': new Blob(['original']), [raw]: new Blob(['binary']) };
    const state = fixture(original);
    state.hooks.write = number => { if (number === 1) state.replace({ 'text/plain': new Blob([]), [raw]: new Blob([]) }); };
    const error = await state.run().catch((value: Error) => value);
    expect(error.message).toContain('Cannot safely preserve an empty or unavailable non-text Windows clipboard payload:');
    expect(error.message).not.toContain('Clipboard was not modified');
    expect(state.clipboard.write).toHaveBeenCalledTimes(2);
    expect(state.contents()).toEqual(original);
  });
  it('restores an originally empty clipboard after exercising the empty-text round trip', async () => {
    const state = fixture({});
    await expect(state.run()).resolves.toMatchObject({ emptyPlainTextRoundTrip: true, formats: [] });
    expect(state.contents()).toEqual({}); expect(state.clipboard.clear).toHaveBeenCalledOnce();
  });
  it('retains empty raw payloads on platforms outside the Windows guard without writing during capture', async () => {
    const state = fixture({ [raw]: new Blob([]) }, 'linux');
    await expect(state.run()).resolves.toMatchObject({ emptyPlainTextRoundTrip: null, formats: [raw] });
    expect(state.clipboard.write).not.toHaveBeenCalled(); expect(state.clipboard.clear).not.toHaveBeenCalled();
  });
});
