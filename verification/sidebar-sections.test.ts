import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSidebarCollapsed, saveSidebarCollapsed } from '../workbench/lib/sidebar-sections';

afterEach(() => vi.unstubAllGlobals());

describe('sidebar section preferences', () => {
  it('stores independent section flags without conversation data', () => {
    const entries = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value) });
    expect(readSidebarCollapsed('recent')).toBe(false);
    saveSidebarCollapsed('pinned', true); saveSidebarCollapsed('recent', true);
    expect(readSidebarCollapsed('pinned')).toBe(true); expect(readSidebarCollapsed('recent')).toBe(true);
    saveSidebarCollapsed('recent', false);
    expect(readSidebarCollapsed('pinned')).toBe(true); expect(readSidebarCollapsed('recent')).toBe(false);
    expect([...entries]).toEqual([['nook.sidebar.collapsed.pinned', 'true'], ['nook.sidebar.collapsed.recent', 'false']]);
  });
  it.each([null, '', 'false', '1', 'TRUE', '{}', 'null'])('defaults to open for missing or invalid preference %s', value => {
    vi.stubGlobal('localStorage', { getItem: () => value });
    expect(readSidebarCollapsed('recent')).toBe(false);
  });
  it('keeps storage errors from breaking navigation', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } });
    expect(readSidebarCollapsed('pinned')).toBe(false);
    expect(() => saveSidebarCollapsed('pinned', true)).not.toThrow();
  });
  it('works when the storage object is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readSidebarCollapsed('recent')).toBe(false);
    expect(() => saveSidebarCollapsed('recent', true)).not.toThrow();
  });
});
