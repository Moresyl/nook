import type { WorktreeOwnershipSource } from '../../contracts/worktree-ownership';
import type { WorktreeSnapshotSummary } from '../../contracts/worktree-snapshots';

export type SavedWorktreeSnapshots = { source: WorktreeOwnershipSource; snapshots: WorktreeSnapshotSummary[]; failed: boolean };

export async function loadSavedWorktreeSnapshots(sources: readonly WorktreeOwnershipSource[], read: (source: WorktreeOwnershipSource) => Promise<WorktreeSnapshotSummary[]>, active: () => boolean): Promise<SavedWorktreeSnapshots[]> {
  const results: SavedWorktreeSnapshots[] = [];
  for (const source of sources) {
    if (!active()) break;
    let snapshots: WorktreeSnapshotSummary[] = [], failed = false;
    try { snapshots = await read(source); } catch { failed = true; }
    if (!active()) break;
    results.push({ source, snapshots, failed });
  }
  return results;
}
