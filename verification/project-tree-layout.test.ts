import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../contracts/projects';
import type { ProjectFolder, ProjectTreeState } from '../workbench/components/project-tree';
import { projectTreeLayout, projectTreeSegments } from '../workbench/components/project-tree-layout';

const file = (path: string, directory = false): FileEntry => ({ name: path.split('/').at(-1)!, relativePath: path, directory });
const folder = (entries: FileEntry[], rest: Partial<ProjectFolder> = {}): ProjectFolder => ({ loading: false, error: false, page: { entries, total: entries.length, nextOffset: null, revision: 'a'.repeat(64) }, ...rest });

describe('project tree virtual layout', () => {
  it('places status blocks after their subtree and retains complete sibling positions', () => {
    const root = folder([file('a', true), file('z')]); root.page!.total = 500; root.page!.nextOffset = 200;
    const state: ProjectTreeState = { folders: new Map([['', root], ['a', folder([file('a/b', true), file('a/c')])], ['a/b', folder([])]]), expanded: new Set(['a', 'a/b']) };
    const layout = projectTreeLayout(state, new Map([['a/b', 34], ['', 40]]));
    expect(layout.rows.map(row => row.entry.relativePath)).toEqual(['a', 'a/b', 'a/c', 'z']);
    expect([...layout.nodes.values()].map(node => [node.path, node.top, node.bottom, node.position, node.size])).toEqual([['a', 0, 118, 1, 500], ['a/b', 28, 90, 1, 2], ['a/c', 90, 118, 2, 2], ['z', 118, 146, 2, 500]]);
    expect(layout.root.statusTop).toBe(146); expect(layout.root.bottom).toBe(186);
    expect(layout.nodes.get('a')!.statusHeight).toBe(0);
  });
  it('estimates loading, errors, empty folders and pagination without retaining obsolete measurements', () => {
    const state = (value: ProjectFolder): ProjectTreeState => ({ folders: new Map([['', value]]), expanded: new Set() });
    expect(projectTreeLayout(state({ loading: true, error: false }), new Map()).root.bottom).toBe(28);
    expect(projectTreeLayout(state({ loading: false, error: true }), new Map()).root.bottom).toBe(96);
    expect(projectTreeLayout(state(folder([])), new Map()).root.bottom).toBe(28);
    const more = folder([file('x')], { loading: true, error: true }); more.page!.nextOffset = 200;
    expect(projectTreeLayout(state(more), new Map()).root.bottom).toBe(184);
    expect(projectTreeLayout(state(folder([file('x')])), new Map([['', 300]])).root.bottom).toBe(28);
    for (const invalid of [0, -1, NaN, Infinity]) expect(projectTreeLayout(state(folder([])), new Map([['', invalid]])).root.bottom).toBe(28);
    expect(projectTreeLayout({ folders: new Map(), expanded: new Set() }, new Map()).root.bottom).toBe(0);
  });
  it('drops collapsed descendants and tolerates duplicate or cyclic entries', () => {
    const state: ProjectTreeState = { folders: new Map([['', folder([file('__proto__', true), file('__proto__', true)])], ['__proto__', folder([file('__proto__', true), file('__proto__/x')])]]), expanded: new Set(['__proto__']) };
    expect(projectTreeLayout(state, new Map()).root.bottom).toBe(56);
    expect(projectTreeLayout({ ...state, expanded: new Set() }, new Map()).root.bottom).toBe(28);
  });
  it('bounds mounted rows and coalesces excluded rows while retaining a remote focus path', () => {
    const layout = projectTreeLayout({ folders: new Map([['', folder(Array.from({ length: 10000 }, (_, index) => file(`file-${index}`)))]]), expanded: new Set() }, new Map());
    const segments = projectTreeSegments(layout.root.children, 28000, 560, 'file-9999');
    const mounted = segments.filter(segment => segment.kind === 'node');
    expect(mounted).toHaveLength(41); expect(mounted.at(-1)?.node.path).toBe('file-9999');
    expect(segments.filter(segment => segment.kind === 'space')).toHaveLength(2);
    expect(segments.reduce((total, segment) => total + (segment.kind === 'space' ? segment.height : segment.node.bottom - segment.node.top), 0)).toBe(280000);
    expect(projectTreeSegments(layout.root.children, -10, 0, '').filter(segment => segment.kind === 'node')).toHaveLength(10);
  });
  it('retains ancestors of a pinned node without confusing common path prefixes', () => {
    const state: ProjectTreeState = { folders: new Map([['', folder([file('a', true), file('ab', true)])], ['a', folder([file('a/x')])], ['ab', folder([file('ab/y')])]]), expanded: new Set(['a', 'ab']) };
    const layout = projectTreeLayout(state, new Map());
    const segments = projectTreeSegments(layout.root.children, 20000, 100, 'a/x');
    expect(segments.map(segment => segment.kind === 'node' ? segment.node.path : 'space')).toEqual(['a', 'space']);
    expect(projectTreeSegments([], 0, 100, '')).toEqual([]);
  });
});
