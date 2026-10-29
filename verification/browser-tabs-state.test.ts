import { describe, expect, it } from 'vitest';
import { reduceBrowserTabs, type BrowserTabsAction, type BrowserWorkspace } from '../workbench/components/browser-tabs-state';
import type { BrowserState } from '../contracts/browser';
const state = (token: string, sequence = 1): BrowserState => ({ token, sequence, url: `https://${token}.example/`, title: token, loading: false, canGoBack: false, canGoForward: false, error: null, notice: null });
const create = (workspace: BrowserWorkspace, token: string, activate = true) => reduceBrowserTabs(workspace, { type: 'created', state: state(token), activate });
const fixture = () => create(create({ tabs: [], active: null, error: null }, 'first'), 'second');
describe('browser tab state ownership', () => {
  it('retains independent address drafts and ignores background titles for the selected address', () => {
    let workspace = fixture(); workspace = reduceBrowserTabs(workspace, { type: 'edited', token: 'first', address: 'https://unsent.example/中文😀' }); workspace = reduceBrowserTabs(workspace, { type: 'selected', token: 'first' });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('second', 2), title: 'BACKGROUND' } });
    expect(workspace.active).toBe('first'); expect(workspace.tabs[0].address).toBe('https://unsent.example/中文😀'); expect(workspace.tabs[1].state.title).toBe('BACKGROUND');
    workspace = reduceBrowserTabs(workspace, { type: 'selected', token: 'second' }); expect(workspace.tabs[0].address).toContain('unsent');
  });
  it('accepts newest navigation only and does not resurrect closed owners or errors', () => {
    let workspace = fixture(); workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 4), url: 'https://redirect.example/' } });
    expect(reduceBrowserTabs(workspace, { type: 'received', state: state('first', 3) })).toBe(workspace); expect(reduceBrowserTabs(workspace, { type: 'received', state: state('first', 4) })).toBe(workspace);
    workspace = reduceBrowserTabs(workspace, { type: 'removed', token: 'first' });
    for (const action of [{ type: 'received', state: state('first', 5) }, { type: 'failed', token: 'first', message: 'OLD' }, { type: 'selected', token: 'first' }, { type: 'removed', token: 'first' }] as BrowserTabsAction[]) expect(reduceBrowserTabs(workspace, action)).toBe(workspace);
  });
  it('settles submitted redirects/stop and clears failed attempts without touching another tab', () => {
    let workspace = fixture(); const other = workspace.tabs[1]; workspace = reduceBrowserTabs(workspace, { type: 'edited', token: 'first', address: 'https://pending.example/' }); workspace = reduceBrowserTabs(workspace, { type: 'submitted', token: 'first' });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 2), loading: true } }); expect(workspace.tabs[0]).toMatchObject({ pending: true, address: 'https://pending.example/' });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: state('first', 3) }); expect(workspace.tabs[0]).toMatchObject({ pending: false, address: 'https://first.example/' });
    workspace = reduceBrowserTabs(workspace, { type: 'failed', token: 'first', message: 'RETRY' }); expect(workspace.tabs[0].error).toBe('RETRY'); workspace = reduceBrowserTabs(workspace, { type: 'submitted', token: 'first' }); expect(workspace.tabs[0].error).toBeNull(); expect(workspace.tabs[1]).toBe(other);
  });
  it('selects a close neighbor, leaves inactive-close selection intact and permits a fresh blank tab', () => {
    let workspace = create(fixture(), 'last'); workspace = reduceBrowserTabs(workspace, { type: 'selected', token: 'second' }); workspace = reduceBrowserTabs(workspace, { type: 'removed', token: 'second' }); expect(workspace.active).toBe('last');
    workspace = reduceBrowserTabs(workspace, { type: 'removed', token: 'first' }); expect(workspace.active).toBe('last'); workspace = reduceBrowserTabs(workspace, { type: 'removed', token: 'last' }); expect(workspace.active).toBeNull();
    workspace = reduceBrowserTabs(workspace, { type: 'open-failed', message: 'OPEN_ERROR' }); expect(workspace.error).toBe('OPEN_ERROR'); workspace = create(workspace, 'fresh', false); expect(workspace.active).toBe('fresh'); expect(workspace.error).toBeNull();
  });
  it('does not duplicate an owner or steal a newer selection when create resolves late', () => {
    const original = fixture(), late = create(original, 'third', false); expect(late.active).toBe('second'); expect(late.tabs).toHaveLength(3);
    const duplicate = create(late, 'third', false); expect(duplicate.tabs).toHaveLength(3); expect(duplicate.active).toBe('second'); expect(original.tabs).toHaveLength(2);
  });
  it('preserves an address edited during loading through failure and same-URL retry', () => {
    let workspace = fixture(); workspace = reduceBrowserTabs(workspace, { type: 'submitted', token: 'first' });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 2), loading: true } });
    const address = 'https://unsent.example/中文😀'; workspace = reduceBrowserTabs(workspace, { type: 'edited', token: 'first', address });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 3), error: 'Failed', failureReason: 'timeout' } });
    expect(workspace.tabs[0].address).toBe(address);
    workspace = reduceBrowserTabs(workspace, { type: 'submitted', token: 'first', preserveAddress: true });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 4), loading: true } });
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: state('first', 5) }); expect(workspace.tabs[0].address).toBe(address);
    workspace = reduceBrowserTabs(workspace, { type: 'received', state: { ...state('first', 6), url: 'https://redirect.example/' } }); expect(workspace.tabs[0].address).toBe('https://redirect.example/');
  });
});
