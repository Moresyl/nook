import type { ManagedWorktree, WorktreeOwnershipSource } from '../../contracts/worktree-ownership';

export type WorktreeOwnershipSnapshot = { source: WorktreeOwnershipSource; records: ManagedWorktree[]; failed: boolean };

export async function loadWorktreeOwnership(sources: readonly WorktreeOwnershipSource[], read: (source: WorktreeOwnershipSource) => Promise<ManagedWorktree[]>, active: () => boolean): Promise<WorktreeOwnershipSnapshot[]> {
  const snapshots: WorktreeOwnershipSnapshot[] = [];
  for (const source of sources) {
    if (!active()) break;
    let records: ManagedWorktree[] = [], failed = false;
    try { records = await read(source); } catch { failed = true; }
    if (!active()) break;
    snapshots.push({ source, records, failed });
  }
  return snapshots;
}
