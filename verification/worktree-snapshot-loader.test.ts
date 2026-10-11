import { describe, expect, it, vi } from 'vitest';
import type { WorktreeSnapshotSummary } from '../contracts/worktree-snapshots';
import { loadSavedWorktreeSnapshots } from '../workbench/lib/worktree-snapshots';

const source = { projectId: 'source', path: 'E:/源项目' };
const snapshot: WorktreeSnapshotSummary = { version: 1, id: 'e0502d20-4555-4db7-99c0-92947476e6a1', receiptId: 'a9d007f5-106a-425f-b558-eec67235a1c1', createdAt: 1, originalPath: 'E:/工作树', head: 'a'.repeat(40), common: { path: 'E:/源项目/.git', device: '1', inode: '2' }, entries: 2, fileBytes: 8 };
describe('saved snapshot page loading', () => {
  it('reads supplied sources in order without overlapping reads and preserves durable summaries', async () => {
    const second = { projectId: 'second', path: 'E:/second' }; let release!: (value: WorktreeSnapshotSummary[]) => void;
    const read = vi.fn().mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValueOnce([]);
    const pending = loadSavedWorktreeSnapshots([source, second], read, () => true); expect(read).toHaveBeenCalledTimes(1);
    release([snapshot]); expect(await pending).toEqual([{ source, snapshots: [snapshot], failed: false }, { source: second, snapshots: [], failed: false }]);
    expect(read.mock.calls.map(call => call[0])).toEqual([source, second]);
  });
  it('isolates a failed repository without revealing private errors or fabricating snapshots', async () => {
    const second = { ...source, projectId: 'second' }, read = vi.fn().mockRejectedValueOnce(new Error('PRIVATE')).mockResolvedValueOnce([snapshot]);
    expect(await loadSavedWorktreeSnapshots([source, second], read, () => true)).toEqual([{ source, snapshots: [], failed: true }, { source: second, snapshots: [snapshot], failed: false }]);
  });
  it('avoids reads for an empty or cancelled page', async () => {
    const read = vi.fn(); expect(await loadSavedWorktreeSnapshots([], read, () => true)).toEqual([]); expect(await loadSavedWorktreeSnapshots([source], read, () => false)).toEqual([]); expect(read).not.toHaveBeenCalled();
  });
  it('discards a held response after cancellation and never reads the next source', async () => {
    let active = true, release!: (value: WorktreeSnapshotSummary[]) => void;
    const read = vi.fn(() => new Promise<WorktreeSnapshotSummary[]>(resolve => { release = resolve; }));
    const pending = loadSavedWorktreeSnapshots([source, source], read, () => active); active = false; release([snapshot]);
    expect(await pending).toEqual([]); expect(read).toHaveBeenCalledTimes(1);
  });
});
