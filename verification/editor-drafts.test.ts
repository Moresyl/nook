import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushEditorDrafts, persistEditorDraft, registerEditorDrafts } from '../workbench/components/editor-drafts';
const draft = { projectId: 'one', path: 'file.ts', text: 'Draft', baseText: 'Base', baseSha256: null, updatedAt: 1 };
afterEach(() => vi.unstubAllGlobals());
describe('editor draft coordination', () => {
  it('flushes only the selected editor and awaits pending writes even after it unmounts', async () => {
    let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal('window', { qiyao: { saveEditorDraft: vi.fn(() => hold) } });
    const one = vi.fn(() => persistEditorDraft(draft)); const two = vi.fn(async () => {});
    const unregisterOne = registerEditorDrafts('one', one); const unregisterTwo = registerEditorDrafts('two', two);
    let completed = false; const flushing = flushEditorDrafts('one').then(() => { completed = true; });
    await Promise.resolve(); expect(completed).toBe(false); expect(two).not.toHaveBeenCalled(); unregisterOne(); release(); await flushing; expect(completed).toBe(true);
    await flushEditorDrafts(); expect(two).toHaveBeenCalledOnce(); unregisterTwo();
  });
  it('reports a failed persistence operation and permits a later retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
    vi.stubGlobal('window', { qiyao: { saveEditorDraft: save } });
    const unregister = registerEditorDrafts('one', () => persistEditorDraft(draft));
    await expect(flushEditorDrafts('one')).rejects.toThrow('Disk full'); await flushEditorDrafts('one'); expect(save).toHaveBeenCalledTimes(2); unregister();
  });
});
