import { describe, expect, it } from 'vitest';
import { verifyNavigationProof } from '../scripts/release-policy.mjs';
import { navigationReleaseProof } from './navigation-release-fixture';

type Fixture = ReturnType<typeof navigationReleaseProof>;

describe('navigation release evidence', () => {
  it('accepts complete current evidence and future complete-suite counts without changing the record', () => {
    const value = navigationReleaseProof(), original = structuredClone(value);
    expect(() => verifyNavigationProof(value)).not.toThrow(); expect(value).toEqual(original);
    value.checks += 1; expect(() => verifyNavigationProof(value)).not.toThrow();
  });

  it('rejects absent or previous complete-suite records and non-integer counts', () => {
    expect(() => verifyNavigationProof(undefined)).toThrow('sidebar pagination');
    for (const checks of [0, 383, 411, 412.5, Number.NaN, Number.POSITIVE_INFINITY, '412', undefined]) {
      const value = navigationReleaseProof(); Reflect.set(value, 'checks', checks);
      expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination');
    }
  });

  it('requires the navigation, automatic-pagination and tree records', () => {
    for (const [select, key, message] of [
      [(p: Fixture) => p, 'chatNavigation', 'sidebar pagination'],
      [(p: Fixture) => p.chatNavigation, 'sidebarNavigation', 'sidebar pagination'],
      [(p: Fixture) => p.chatNavigation.sidebarNavigation, 'automaticPagination', 'sidebar pagination'],
      [(p: Fixture) => p, 'projectTree', 'project-tree'],
      [(p: Fixture) => p.projectTree, 'virtualizedRows', 'project-tree'],
      [(p: Fixture) => p.projectTree, 'stickyFolders', 'project-tree'],
      [(p: Fixture) => p.projectTree.stickyFolders, 'virtualizedLargeDirectory', 'project-tree'],
      [(p: Fixture) => p.projectTree.stickyFolders, 'fileMenu', 'project-tree'],
    ] as const) {
      for (const absent of [undefined, null, {}, []]) {
        const value = navigationReleaseProof(); Reflect.set(select(value), key, absent);
        expect(() => verifyNavigationProof(value)).toThrow(message);
      }
    }
  });

  it('rejects partial navigation suites, insufficient fixtures and incorrect batch sizes', () => {
    for (const checks of [4, 6, Number.NaN]) { const value = navigationReleaseProof(); value.chatNavigation.checks = checks; expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination'); }
    for (const fixtures of [119, 120.5, Number.NaN]) { const value = navigationReleaseProof(); value.chatNavigation.sidebarNavigation.fixtures = fixtures; expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination'); }
    for (const [key, invalid] of [['batches', 1], ['batches', 3], ['pageSize', 9], ['pageSize', 11]] as const) {
      const value = navigationReleaseProof(); value.chatNavigation.sidebarNavigation.automaticPagination[key] = invalid;
      expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination');
    }
  });

  it('requires exact booleans for pagination, focus, drafts and tree interaction retention', () => {
    const groups = [
      [(p: Fixture) => p.chatNavigation.sidebarNavigation, 'sidebar pagination'],
      [(p: Fixture) => p.chatNavigation.sidebarNavigation.automaticPagination, 'sidebar pagination'],
      [(p: Fixture) => p.projectTree.virtualizedRows, 'project-tree'],
      [(p: Fixture) => p.projectTree.stickyFolders, 'project-tree'],
      [(p: Fixture) => p.projectTree.stickyFolders.virtualizedLargeDirectory, 'project-tree'],
      [(p: Fixture) => p.projectTree.stickyFolders.fileMenu, 'project-tree'],
    ] as const;
    for (const [select, message] of groups) {
      const keys = Object.entries(select(navigationReleaseProof())).filter(([, value]) => typeof value === 'boolean').map(([key]) => key);
      for (const key of keys) for (const invalid of [false, undefined, 'true', 1]) {
        const value = navigationReleaseProof(); Reflect.set(select(value), key, invalid);
        expect(() => verifyNavigationProof(value)).toThrow(message);
      }
    }
  });

  it('requires six unique theme/zoom layouts with the expected loaded rows and capture names', () => {
    for (const layouts of [undefined, [], [null], navigationReleaseProof().chatNavigation.sidebarNavigation.automaticPagination.layouts.slice(0, 5)]) {
      const value = navigationReleaseProof(); Reflect.set(value.chatNavigation.sidebarNavigation.automaticPagination, 'layouts', layouts);
      expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination');
    }
    for (const change of [{ theme: 'light' }, { zoom: 1.25 }, { rows: 20 }, { rows: 22 }, { screenshot: '../PRIVATE.png' }, { zoom: Number.NaN }]) {
      const value = navigationReleaseProof(), layouts = value.chatNavigation.sidebarNavigation.automaticPagination.layouts;
      layouts[5] = { ...layouts[5], ...change }; expect(() => verifyNavigationProof(value)).toThrow('sidebar pagination');
    }
    const extra = navigationReleaseProof(); extra.chatNavigation.sidebarNavigation.automaticPagination.layouts.push(extra.chatNavigation.sidebarNavigation.automaticPagination.layouts[0]);
    expect(() => verifyNavigationProof(extra)).toThrow('sidebar pagination');
  });

  it('rejects old tree counts and incomplete root pagination or large-directory traversal', () => {
    for (const checks of [7, 9, Number.NaN]) { const value = navigationReleaseProof(); value.projectTree.checks = checks; expect(() => verifyNavigationProof(value)).toThrow('project-tree'); }
    for (const counts of [undefined, [], [200], [225, 200], [200, 224], [200, 225, 250]]) {
      const value = navigationReleaseProof(); Reflect.set(value.projectTree.virtualizedRows, 'rootLoadedCounts', counts);
      expect(() => verifyNavigationProof(value)).toThrow('project-tree');
    }
    for (const change of [{ files: 999 }, { pages: 4 }, { mountedRows: 0 }, { mountedRows: 1000 }, { mountedRows: 1.5 }, { mountedRows: Number.NaN }]) {
      const value = navigationReleaseProof(); Object.assign(value.projectTree.stickyFolders.virtualizedLargeDirectory, change);
      expect(() => verifyNavigationProof(value)).toThrow('project-tree');
    }
  });

  it('rejects missing or duplicated menu theme/zoom evidence and clipped or malformed geometry', () => {
    for (const themes of [undefined, [], ['light'], ['light', 'light'], ['light', 'dark', 'dark']]) {
      const value = navigationReleaseProof(); Reflect.set(value.projectTree.stickyFolders.fileMenu, 'themes', themes);
      expect(() => verifyNavigationProof(value)).toThrow('project-tree');
    }
    for (const geometry of [undefined, [], [null]]) {
      const value = navigationReleaseProof(); Reflect.set(value.projectTree.stickyFolders.fileMenu, 'geometry', geometry);
      expect(() => verifyNavigationProof(value)).toThrow('project-tree');
    }
    for (const change of [{ zoom: 1 }, { left: -1 }, { right: 508 }, { top: 35 }, { bottom: 361 }, { width: 0 }, { height: 0 }, { chrome: -1 }, { right: 68 }, { bottom: 100 }, { left: Number.NaN }]) {
      const value = navigationReleaseProof(), geometry = value.projectTree.stickyFolders.fileMenu.geometry;
      geometry[2] = { ...geometry[2], ...change }; expect(() => verifyNavigationProof(value)).toThrow('project-tree');
    }
  });
});
