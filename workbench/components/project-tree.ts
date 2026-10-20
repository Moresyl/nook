import type { DirectoryPage, DirectoryRequest, FileEntry } from '../../contracts/projects';

export type ProjectFolder = { page?: DirectoryPage; loading: boolean; error: boolean };
export type ProjectTreeState = { folders: ReadonlyMap<string, ProjectFolder>; expanded: ReadonlySet<string> };
export type ProjectTreeRow = { entry: FileEntry; level: number };
export type ProjectTreeAction = { kind: 'focus' | 'expand' | 'collapse' | 'open'; path: string };

export function projectTreeScrollDelta(top: number, bottom: number, viewportHeight: number, level: number): number {
  if (viewportHeight <= 0) return 0;
  const inset = viewportHeight < 64 ? 4 : Math.min(4 + Math.max(0, level - 1) * 28, viewportHeight - 32);
  if (top < inset) return top - inset;
  return Math.max(0, bottom - (viewportHeight - 4));
}

export function projectTreeMatch(rows: readonly ProjectTreeRow[], path: string, query: string): string | undefined {
  if (!query || !rows.length) return;
  const normalized = query.normalize('NFC').toLowerCase();
  const letters = Array.from(normalized), cycling = letters.every(letter => letter === letters[0]);
  const prefix = cycling ? letters[0] : normalized;
  const current = rows.findIndex(row => row.entry.relativePath === path);
  const start = current < 0 ? 0 : (current + (cycling ? 1 : 0)) % rows.length;
  for (let offset = 0; offset < rows.length; offset++) {
    const entry = rows[(start + offset) % rows.length].entry;
    if (entry.name.normalize('NFC').toLowerCase().startsWith(prefix)) return entry.relativePath;
  }
}

export function projectTreeRows(state: ProjectTreeState): ProjectTreeRow[] {
  const result: ProjectTreeRow[] = [];
  const seen = new Set<string>();
  const pending = (state.folders.get('')?.page?.entries ?? []).toReversed().map((entry) => ({ entry, level: 1 }));
  while (pending.length) {
    const row = pending.pop()!;
    if (seen.has(row.entry.relativePath)) continue;
    seen.add(row.entry.relativePath); result.push(row);
    if (row.entry.directory && state.expanded.has(row.entry.relativePath)) {
      const children = state.folders.get(row.entry.relativePath)?.page?.entries ?? [];
      for (let index = children.length - 1; index >= 0; index--) pending.push({ entry: children[index], level: row.level + 1 });
    }
  }
  return result;
}

export function projectTreeKey(rows: readonly ProjectTreeRow[], expanded: ReadonlySet<string>, path: string, key: string): ProjectTreeAction | null {
  const index = rows.findIndex((row) => row.entry.relativePath === path);
  const row = rows[index]; if (!row) return null;
  if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
    const target = key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (key === 'ArrowDown' ? 1 : -1)));
    return { kind: 'focus', path: rows[target].entry.relativePath };
  }
  if (key === 'Enter' || key === ' ') return { kind: row.entry.directory ? expanded.has(path) ? 'collapse' : 'expand' : 'open', path };
  if (key === 'ArrowRight' && row.entry.directory) {
    if (!expanded.has(path)) return { kind: 'expand', path };
    if (rows[index + 1]?.level === row.level + 1) return { kind: 'focus', path: rows[index + 1].entry.relativePath };
  }
  if (key === 'ArrowLeft') {
    if (row.entry.directory && expanded.has(path)) return { kind: 'collapse', path };
    const parent = rows.slice(0, index).findLast((item) => item.level < row.level);
    if (parent) return { kind: 'focus', path: parent.entry.relativePath };
  }
  return null;
}

export class ProjectTree {
  private folders = new Map<string, ProjectFolder>();
  private expanded = new Set<string>();
  private pending = new Map<string, Promise<boolean>>();
  private generation = 0;
  private revealing = 0;
  private disposed = false;
  constructor(private readonly list: (request: DirectoryRequest) => Promise<DirectoryPage>, private readonly changed: (state: ProjectTreeState) => void) {}

  get state(): ProjectTreeState { return { folders: new Map(this.folders), expanded: new Set(this.expanded) }; }
  private publish() { if (!this.disposed) this.changed(this.state); }

  load(path = '', mode: 'cached' | 'refresh' | 'more' = 'cached'): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    const existing = this.pending.get(path); if (existing) return existing;
    const before = this.folders.get(path);
    if (mode === 'cached' && before?.page && !before.error) return Promise.resolve(true);
    if (mode === 'more' && (!before?.page || before.page.nextOffset === null)) return Promise.resolve(false);
    const generation = this.generation;
    const request: DirectoryRequest = { path, ...(mode === 'more' ? { offset: before!.page!.nextOffset!, revision: before!.page!.revision } : {}) };
    this.folders.set(path, { ...before, loading: true, error: false }); this.publish();
    const promise = Promise.resolve().then(() => this.list(request)).then((page) => {
      if (this.disposed || generation !== this.generation) return false;
      if (mode === 'more' && page.revision !== before!.page!.revision) throw new Error('The directory listing changed.');
      const entries = mode === 'more' ? [...before!.page!.entries, ...page.entries] : page.entries;
      this.folders.set(path, { page: { ...page, entries }, loading: false, error: false });
      return true;
    }).catch(() => {
      if (!this.disposed && generation === this.generation) this.folders.set(path, { ...before, loading: false, error: true });
      return false;
    }).finally(() => {
      if (this.pending.get(path) === promise) this.pending.delete(path);
      if (generation === this.generation) this.publish();
    });
    this.pending.set(path, promise);
    return promise;
  }

  expand(path: string): Promise<boolean> { if (this.disposed) return Promise.resolve(false); this.revealing++; this.expanded.add(path); this.publish(); return this.load(path); }
  collapse(path: string) { if (this.disposed) return; this.revealing++; this.expanded.delete(path); this.publish(); }
  collapseAll() { if (this.disposed) return; this.revealing++; this.expanded.clear(); this.publish(); }

  private async refreshDirectory(path: string, generation: number): Promise<void> {
    const count = this.folders.get(path)?.page?.entries.length ?? 0;
    if (!await this.load(path, 'refresh')) return;
    while (!this.disposed && generation === this.generation && (this.folders.get(path)?.page?.entries.length ?? 0) < count) {
      if (!await this.load(path, 'more')) break;
    }
  }

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.pending.clear();
    for (const [path, folder] of this.folders) this.folders.set(path, { ...folder, loading: false });
    await this.refreshDirectory('', generation);
    for (const path of [...this.expanded]) {
      if (this.disposed || generation !== this.generation) return;
      if (projectTreeRows(this.state).some((row) => row.entry.directory && row.entry.relativePath === path)) await this.refreshDirectory(path, generation);
    }
  }

  private async find(directory: string, path: string): Promise<FileEntry | undefined> {
    if (!await this.load(directory)) return;
    while (!this.disposed) {
      const folder = this.folders.get(directory)!;
      const entry = folder.page?.entries.find((item) => item.relativePath === path); if (entry) return entry;
      if (folder.page?.nextOffset === null || !await this.load(directory, 'more')) return;
    }
  }

  async reveal(path: string): Promise<boolean> {
    const generation = this.generation;
    const revealing = ++this.revealing;
    const parts = path.replaceAll('\\', '/').split('/');
    if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) return false;
    let directory = '';
    for (let index = 0; index < parts.length; index++) {
      const target = parts.slice(0, index + 1).join('/');
      const entry = await this.find(directory, target);
      if (this.disposed || generation !== this.generation || revealing !== this.revealing || !entry) return false;
      if (index === parts.length - 1) return !entry.directory;
      if (!entry.directory) return false;
      this.expanded.add(target); this.publish(); directory = target;
    }
    return false;
  }

  dispose() { this.disposed = true; this.generation++; this.pending.clear(); }
}
