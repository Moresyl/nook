import { describe, expect, it, vi } from 'vitest';
import type { DirectoryPage, FileEntry } from '../contracts/projects';
import { ProjectTree, projectTreeKey, projectTreeMatch, projectTreeRows, projectTreeScrollDelta, type ProjectTreeState } from '../workbench/components/project-tree';

const file = (relativePath: string, directory = false): FileEntry => ({ name: relativePath.split('/').at(-1)!, relativePath, directory });

describe('file tree focus visibility', () => {
  it('keeps visible rows still and reveals rows above or below the viewport', () => {
    expect(projectTreeScrollDelta(4, 32, 200, 1)).toBe(0);
    expect(projectTreeScrollDelta(-24, 4, 200, 1)).toBe(-28);
    expect(projectTreeScrollDelta(192, 220, 200, 1)).toBe(24);
  });
  it('reserves ancestor rows while moving into an expanded subtree', () => {
    expect(projectTreeScrollDelta(4, 32, 200, 3)).toBe(-56);
    expect(projectTreeScrollDelta(60, 88, 200, 3)).toBe(0);
  });
  it('bounds the ancestor inset in short viewports and ignores hidden trees', () => {
    expect(projectTreeScrollDelta(40, 68, 100, 8)).toBe(-28);
    expect(projectTreeScrollDelta(68, 96, 100, 8)).toBe(0);
    expect(projectTreeScrollDelta(4, 32, 0, 3)).toBe(0);
    expect(projectTreeScrollDelta(4, 32, 50, 8)).toBe(0);
  });
});

describe('file tree prefix navigation', () => {
  const rows = ['source', 'source/Alpha.ts', 'alpha.txt', 'Beta.ts', 'éclair.txt', '资料.md', '😀.txt'].map(path => ({ entry: file(path), level: path.includes('/') ? 2 : 1 }));
  it('cycles repeated letters and wraps without selecting or opening files', () => {
    expect(projectTreeMatch(rows, 'source', 'a')).toBe('source/Alpha.ts');
    expect(projectTreeMatch(rows, 'source/Alpha.ts', 'AA')).toBe('alpha.txt');
    expect(projectTreeMatch(rows, 'alpha.txt', 'aaa')).toBe('source/Alpha.ts');
    expect(projectTreeMatch(rows, 'Beta.ts', 'b')).toBe('Beta.ts');
  });
  it('keeps a matching current row while refining a multi-character prefix', () => {
    expect(projectTreeMatch(rows, 'source/Alpha.ts', 'Alp')).toBe('source/Alpha.ts');
    expect(projectTreeMatch(rows, 'source/Alpha.ts', 'alpha.t')).toBe('source/Alpha.ts');
    expect(projectTreeMatch(rows, 'source/Alpha.ts', 'alpha.tx')).toBe('alpha.txt');
  });
  it('normalizes Unicode and matches basenames at any visible depth', () => {
    expect(projectTreeMatch(rows, 'source', 'e\u0301c')).toBe('éclair.txt');
    expect(projectTreeMatch(rows, 'source', '资料')).toBe('资料.md');
    expect(projectTreeMatch(rows, 'source', '😀')).toBe('😀.txt');
    expect(projectTreeMatch(rows, 'missing', 'a')).toBe('source/Alpha.ts');
  });
  it('does not invent matches or traverse unloaded and collapsed entries', () => {
    expect(projectTreeMatch([], '', 'a')).toBeUndefined();
    expect(projectTreeMatch(rows, 'source', '')).toBeUndefined();
    expect(projectTreeMatch(rows, 'source', 'missing')).toBeUndefined();
    expect(projectTreeMatch(rows.slice(0, 1), 'source', 'a')).toBeUndefined();
    expect(projectTreeMatch(rows, 'source', 'source/Alpha')).toBeUndefined();
  });
});
const page = (entries: FileEntry[], change: Partial<DirectoryPage> = {}): DirectoryPage => ({ entries, revision: 'a'.repeat(64), total: entries.length, nextOffset: null, ...change });
const loaded = (entries: FileEntry[]) => ({ page: page(entries), loading: false, error: false });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('project tree rows and keyboard navigation', () => {
  const state: ProjectTreeState = { folders: new Map([['', loaded([file('__proto__', true), file('root.txt')])], ['__proto__', loaded([file('__proto__/nested', true), file('__proto__/note.txt')])], ['__proto__/nested', loaded([file('__proto__/nested/code.ts')])]]), expanded: new Set(['__proto__', '__proto__/nested']) };
  it('flattens only expanded cached directories in sibling order with correct ARIA levels and prototype-safe paths', () => {
    expect(projectTreeRows(state).map((row) => [row.entry.relativePath, row.level])).toEqual([['__proto__', 1], ['__proto__/nested', 2], ['__proto__/nested/code.ts', 3], ['__proto__/note.txt', 2], ['root.txt', 1]]);
    expect(projectTreeRows({ ...state, expanded: new Set() }).map((row) => row.entry.relativePath)).toEqual(['__proto__', 'root.txt']);
    expect(projectTreeRows({ folders: new Map(), expanded: new Set(['missing']) })).toEqual([]);
    expect(projectTreeRows({ folders: new Map([['', loaded([file('cycle', true), file('cycle', true)])], ['cycle', loaded([file('cycle', true)])]]), expanded: new Set(['cycle']) })).toHaveLength(1);
  });
  it('moves forward/backward, to both ends and to the visible parent, keeping boundary selections valid', () => {
    const rows = projectTreeRows(state);
    expect(projectTreeKey(rows, state.expanded, '__proto__', 'ArrowUp')).toEqual({ kind: 'focus', path: '__proto__' });
    expect(projectTreeKey(rows, state.expanded, '__proto__', 'ArrowDown')?.path).toBe('__proto__/nested');
    expect(projectTreeKey(rows, state.expanded, '__proto__/nested/code.ts', 'ArrowLeft')?.path).toBe('__proto__/nested');
    expect(projectTreeKey(rows, state.expanded, 'root.txt', 'ArrowDown')?.path).toBe('root.txt');
    expect(projectTreeKey(rows, state.expanded, 'root.txt', 'Home')?.path).toBe('__proto__');
    expect(projectTreeKey(rows, state.expanded, '__proto__', 'End')?.path).toBe('root.txt');
    expect(projectTreeKey(rows, state.expanded, 'root.txt', 'ArrowLeft')).toBeNull();
    expect(projectTreeKey(rows, state.expanded, 'root.txt', 'ArrowRight')).toBeNull();
    expect(projectTreeKey(rows, state.expanded, 'root.txt', 'Other')).toBeNull();
    expect(projectTreeKey(rows, state.expanded, 'missing', 'Home')).toBeNull();
  });
  it('expands/collapses directories and opens files through Enter/Space without mistaking siblings for children', () => {
    const rows = projectTreeRows(state);
    expect(projectTreeKey(rows, state.expanded, '__proto__', 'ArrowRight')).toEqual({ kind: 'focus', path: '__proto__/nested' });
    for (const key of ['Enter', ' ']) {
      expect(projectTreeKey(rows, state.expanded, '__proto__', key)).toEqual({ kind: 'collapse', path: '__proto__' });
      expect(projectTreeKey(rows, new Set(), '__proto__', key)).toEqual({ kind: 'expand', path: '__proto__' });
      expect(projectTreeKey(rows, state.expanded, 'root.txt', key)).toEqual({ kind: 'open', path: 'root.txt' });
    }
    expect(projectTreeKey(rows, new Set(), '__proto__', 'ArrowRight')?.kind).toBe('expand');
    expect(projectTreeKey(rows, state.expanded, '__proto__', 'ArrowLeft')?.kind).toBe('collapse');
    expect(projectTreeKey([{ entry: file('empty', true), level: 1 }, { entry: file('sibling.txt'), level: 1 }], new Set(['empty']), 'empty', 'ArrowRight')).toBeNull();
  });
});

describe('scoped project tree request lifecycle', () => {
  it('deduplicates pending requests, caches completed directories and retains nested expansion through collapse', async () => {
    const hold = deferred<DirectoryPage>(); const list = vi.fn(() => hold.promise); const changed = vi.fn();
    const tree = new ProjectTree(list, changed); expect(tree.state.folders.size).toBe(0);
    const first = tree.load(); expect(tree.load()).toBe(first); expect(tree.state.folders.get('')?.loading).toBe(true);
    hold.resolve(page([file('source', true)])); expect(await first).toBe(true); expect(await tree.load()).toBe(true); expect(list).toHaveBeenCalledTimes(1);
    await tree.expand('source'); await tree.expand('source/nested'); tree.collapse('source'); expect(tree.state.expanded.has('source/nested')).toBe(true);
    tree.collapseAll(); expect(tree.state.expanded.size).toBe(0); expect(changed).toHaveBeenCalled();
  });
  it('merges revision-bound pages and rejects inconsistent additional pages while retaining the original complete cache', async () => {
    const first = page([file('a')], { total: 3, nextOffset: 200 });
    const list = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(page([file('b')], { total: 3, nextOffset: 400 })).mockResolvedValueOnce(page([file('wrong')], { revision: 'b'.repeat(64) }));
    const tree = new ProjectTree(list, () => {});
    expect(await tree.load('', 'more')).toBe(false); await tree.load(); await tree.load('', 'more');
    expect(list.mock.calls[1][0]).toEqual({ path: '', offset: 200, revision: first.revision });
    expect(tree.state.folders.get('')?.page?.entries.map((entry) => entry.name)).toEqual(['a', 'b']);
    expect(await tree.load('', 'more')).toBe(false); expect(tree.state.folders.get('')?.error).toBe(true);
    expect(tree.state.folders.get('')?.page?.entries.map((entry) => entry.name)).toEqual(['a', 'b']);
  });
  it('keeps existing data through read failure, supports an atomic retry and ignores stale requests after refresh', async () => {
    const hold = deferred<DirectoryPage>(); const list = vi.fn().mockResolvedValueOnce(page([file('old')])).mockRejectedValueOnce(new Error('Private filesystem detail')).mockImplementationOnce(() => hold.promise).mockResolvedValueOnce(page([file('fresh')]));
    const changed = vi.fn(); const tree = new ProjectTree(list, changed);
    await tree.load(); expect(await tree.load('', 'refresh')).toBe(false);
    expect(tree.state.folders.get('')).toMatchObject({ error: true, loading: false, page: { entries: [file('old')] } });
    const stale = tree.load(); await Promise.resolve(); await tree.refresh();
    hold.resolve(page([file('stale')])); expect(await stale).toBe(false);
    expect(tree.state.folders.get('')).toMatchObject({ error: false, loading: false, page: { entries: [file('fresh')] } });
    expect(JSON.stringify(changed.mock.calls)).not.toContain('Private filesystem detail');
    expect(await tree.load('', 'more')).toBe(false);
  });
  it('refreshes visible expanded directories but skips removed cached folders', async () => {
    const list = vi.fn().mockResolvedValueOnce(page([file('source', true), file('removed', true)])).mockResolvedValueOnce(page([file('source/note')])).mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([file('source', true)])).mockResolvedValueOnce(page([file('source/new')]));
    const tree = new ProjectTree(list, () => {}); await tree.load(); await tree.expand('source'); await tree.expand('removed'); await tree.refresh();
    expect(list.mock.calls.map(([request]) => request.path)).toEqual(['', 'source', 'removed', '', 'source']);
    expect(projectTreeRows(tree.state).map((row) => row.entry.relativePath)).toEqual(['source', 'source/new']);
  });
  it('refreshes the previously loaded page range with fresh revisions instead of dropping a selected later-page file', async () => {
    const list = vi.fn().mockResolvedValueOnce(page([file('first')], { total: 2, nextOffset: 200 })).mockResolvedValueOnce(page([file('later')], { total: 2 })).mockResolvedValueOnce(page([file('added')], { revision: 'b'.repeat(64), total: 2, nextOffset: 200 })).mockResolvedValueOnce(page([file('later')], { revision: 'b'.repeat(64), total: 2 }));
    const tree = new ProjectTree(list, () => {}); await tree.load(); await tree.load('', 'more'); await tree.refresh();
    expect(tree.state.folders.get('')?.page?.entries).toEqual([file('added'), file('later')]);
    expect(list.mock.calls[3][0]).toEqual({ path: '', offset: 200, revision: 'b'.repeat(64) });
  });
  it('reveals files through paginated ancestors, keeps scope and handles empty/missing/non-directory paths', async () => {
    const list = vi.fn().mockResolvedValueOnce(page([file('a')], { total: 2, nextOffset: 200 })).mockResolvedValueOnce(page([file('__proto__', true)], { total: 2 })).mockResolvedValueOnce(page([file('__proto__/资料', true)])).mockResolvedValueOnce(page([file('__proto__/资料/code.ts')]));
    const tree = new ProjectTree(list, () => {}); expect(await tree.reveal('__proto__\\资料\\code.ts')).toBe(true);
    expect([...tree.state.expanded]).toEqual(['__proto__', '__proto__/资料']);
    for (const path of ['', '../outside', '/outside', 'C:\\outside', 'a/no-file', 'missing', '__proto__/资料']) expect(await tree.reveal(path)).toBe(false);
    expect(list).toHaveBeenCalledTimes(4);
  });
  it('reveals a directory through paginated ancestors without treating files as directories', async () => {
    const list = vi.fn().mockResolvedValueOnce(page([file('a')], { total: 2, nextOffset: 200 })).mockResolvedValueOnce(page([file('source', true)], { total: 2 })).mockResolvedValueOnce(page([file('source/new', true), file('source/file')]));
    const tree = new ProjectTree(list, () => {});
    expect(await tree.reveal('source/new', true)).toBe(true);
    expect([...tree.state.expanded]).toEqual(['source']);
    expect(await tree.reveal('source/file', true)).toBe(false);
    expect(await tree.reveal('source/new')).toBe(false);
  });
  it('lets a newer reveal or explicit collapse cancel an older delayed reveal without losing cached data', async () => {
    const hold = deferred<DirectoryPage>(); const list = vi.fn().mockResolvedValueOnce(page([file('source', true), file('root.txt')])).mockImplementationOnce(() => hold.promise);
    const tree = new ProjectTree(list, () => {}); await tree.load();
    const old = tree.reveal('source/nested/file'); await Promise.resolve(); await Promise.resolve();
    expect(await tree.reveal('root.txt')).toBe(true); tree.collapse('source');
    hold.resolve(page([file('source/nested', true)])); expect(await old).toBe(false);
    expect(tree.state.expanded.has('source')).toBe(false);
    expect(tree.state.folders.get('source')?.page?.entries).toEqual([file('source/nested', true)]);
  });
  it('disposes pending work and makes later calls inert without publishing after unmount', async () => {
    const hold = deferred<DirectoryPage>(); const changed = vi.fn(); const list = vi.fn(() => hold.promise); const tree = new ProjectTree(list, changed);
    const pending = tree.load(); tree.dispose(); changed.mockClear(); hold.resolve(page([file('stale')])); expect(await pending).toBe(false);
    expect(await tree.load()).toBe(false); expect(await tree.expand('source')).toBe(false); tree.collapse('source'); tree.collapseAll(); await tree.refresh(); expect(await tree.reveal('file')).toBe(false);
    expect(changed).not.toHaveBeenCalled(); expect(tree.state.folders.get('')?.page).toBeUndefined();
  });
});
