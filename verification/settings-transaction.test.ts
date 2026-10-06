import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composerDraftSchema, type Preferences, type Provider, workspaceSchema } from '../contracts/workspace';
import { persistentWorkspace } from '../contracts/temporary-conversations';
import { WorkspaceVault, type SettingsTransaction } from '../desktop/services/vault';
import { codec, provider, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const context = await testVault(); directories.push(context.directory);
  await context.vault.update(state => { state.threads.push(sampleThread({ messages: [{ id: 'message', role: 'user', content: '保留完整历史😀'.repeat(100_000), attachments: [], createdAt: 1, status: 'complete' }] })); });
  return context;
}
const canonical = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2));
// Compare every byte natively instead of treating multi-MB buffers as objects with millions of properties.
function expectBytes(actual: Buffer, expected: Buffer) {
  expect(actual.byteLength).toBe(expected.byteLength);
  expect(actual.equals(expected)).toBe(true);
}
// Each new disk-consistency case includes multi-MB fixture creation and repeated fsync/restart.
// This is a correctness-suite budget, not a production operation deadline or latency assertion.
const diskCaseBudgetMs = 30_000;

describe('bounded settings transactions', () => {
  it('returns detached provider and preference reads without copying conversation history', async () => {
    const { vault } = await setup(); const before = vault.snapshot(); const snapshot = vi.spyOn(vault, 'snapshot');
    const clones = vi.spyOn(globalThis, 'structuredClone');
    const selected = vault.provider(provider.id)!; const providers = vault.providers(); const preferences = vault.preferences();
    expect(vault.provider('missing')).toBeUndefined(); expect(snapshot).not.toHaveBeenCalled();
    expect(clones.mock.calls.some(([value]) => value && typeof value === 'object' && ('schemaVersion' in value || 'messages' in value))).toBe(false);
    selected.name = 'Changed outside'; selected.models.push('outside'); providers.length = 0; preferences.theme = 'dark';
    clones.mockRestore(); snapshot.mockRestore(); expect(vault.snapshot()).toEqual(before);
  }, diskCaseBudgetMs);

  it('halves whole-workspace clones while preserving canonical primary/backup bytes and restart state', async () => {
    const { vault, directory } = await setup();
    const clones = vi.spyOn(globalThis, 'structuredClone');
    const wholeCopies = () => clones.mock.calls.filter(([value]) => value && typeof value === 'object' && 'schemaVersion' in value).length;
    await vault.update(state => { state.preferences.theme = 'dark'; }); expect(wholeCopies()).toBe(2);
    const before = vault.snapshot(); clones.mockClear(); const snapshot = vi.spyOn(vault, 'snapshot');
    const result = await vault.updateSettings(state => { state.preferences.theme = 'light'; state.providers[0].name = '中文连接'; });
    expect(snapshot).not.toHaveBeenCalled(); expect(wholeCopies()).toBe(1);
    expect(clones.mock.calls.some(([value]) => value && typeof value === 'object' && 'messages' in value)).toBe(false);
    snapshot.mockRestore(); clones.mockRestore();
    expect(result).toEqual(workspaceSchema.parse({ ...before, preferences: { ...before.preferences, theme: 'light' }, providers: [{ ...before.providers[0], name: '中文连接' }] }));
    expectBytes(await readFile(join(directory, 'workspace.backup.json')), canonical(before));
    expectBytes(await readFile(join(directory, 'workspace.json')), canonical(result));
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot()).toEqual(result);
  }, diskCaseBudgetMs);

  it('never exposes histories to callbacks and isolates held input and returned references', async () => {
    const { vault } = await setup(); const history = vault.snapshot().threads; let held!: SettingsTransaction;
    const result = await vault.updateSettings(state => {
      held = state; expect('threads' in state).toBe(false);
      Object.assign(state, { threads: [], notes: [] }); state.providers[0].models.push('new-model'); state.preferences.theme = 'dark';
    });
    held.providers[0].models.push('late-change'); held.preferences.theme = 'light'; result.providers.length = 0; result.threads[0].messages[0].content = 'Outside mutation';
    expect(vault.snapshot().threads).toEqual(history); expect(vault.providers()[0].models).toEqual(['test-model', 'new-model']); expect(vault.preferences().theme).toBe('dark');
  }, diskCaseBudgetMs);

  it('retains generic, draft-checkpoint and settings ordering without losing pending drafts', async () => {
    const { vault, directory } = await setup(); const seen: string[] = [];
    const draft = composerDraftSchema.parse({ threadId: 'thread', text: '保留未发送草稿', updatedAt: 1 });
    const history = vault.update(state => { state.threads[0].title = 'Latest'; state.providers.push({ ...provider, id: 'second' }); seen.push('history'); });
    const composer = vault.commitComposer(state => { state.composerDrafts = [draft]; state.activeThreadId = 'thread'; seen.push('draft'); });
    const settings = vault.updateSettings(state => { expect(state.providers).toHaveLength(2); state.preferences.defaultProviderId = 'second'; seen.push('settings'); });
    await Promise.all([history, composer, settings]); expect(seen).toEqual(['history', 'draft', 'settings']);
    const expected = vault.snapshot(); expect(expected.threads[0].title).toBe('Latest'); expect(expected.composerDrafts).toEqual([draft]);
    expectBytes(await readFile(join(directory, 'workspace.json')), canonical(expected));
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot()).toEqual(expected);
  }, diskCaseBudgetMs);

  it('preserves temporary-state exclusion and exact persistent backup across settings saves', async () => {
    const { vault, directory } = await setup(); await vault.commitComposer(state => { state.activeThreadId = 'thread'; });
    const before = vault.snapshot();
    await vault.update(state => { state.threads.push(sampleThread({ id: 'private', temporary: true, title: 'PRIVATE_TITLE' })); state.activeThreadId = 'private'; state.composerDrafts = [composerDraftSchema.parse({ threadId: 'private', text: 'PRIVATE_DRAFT', updatedAt: 1 })]; });
    const current = await vault.updateSettings(state => { state.preferences.theme = 'dark'; });
    expect(current.activeThreadId).toBe('private'); expect(current.threads).toHaveLength(2); expect(current.composerDrafts[0].text).toBe('PRIVATE_DRAFT');
    expectBytes(await readFile(join(directory, 'workspace.backup.json')), canonical(before));
    const expected = persistentWorkspace(current, 'thread');
    expectBytes(await readFile(join(directory, 'workspace.json')), canonical(expected));
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot()).toEqual(expected);
  }, diskCaseBudgetMs);

  it('rejects invalid settings and callback failures before disk/state changes, then accepts retry', async () => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const primary = await readFile(join(directory, 'workspace.json')); const backup = await readFile(join(directory, 'workspace.backup.json'));
    await expect(vault.updateSettings(state => { state.preferences.theme = 'invalid' as Preferences['theme']; })).rejects.toThrow();
    await expect(vault.updateSettings(state => { state.providers[0].endpoint = 'not a URL'; })).rejects.toThrow();
    await expect(vault.updateSettings(state => { state.providers = Array.from({ length: 101 }, (_, index): Provider => ({ ...provider, id: `provider-${index}` })); })).rejects.toThrow();
    await expect(vault.updateSettings(() => { throw new Error('Callback failed'); })).rejects.toThrow('Callback failed');
    expect(vault.snapshot()).toEqual(before); expectBytes(await readFile(join(directory, 'workspace.json')), primary); expectBytes(await readFile(join(directory, 'workspace.backup.json')), backup);
    await vault.updateSettings(state => { state.preferences.theme = 'dark'; }); expect(vault.preferences().theme).toBe('dark');
  }, diskCaseBudgetMs);

  it.each(['workspace.backup.json', 'workspace.json'])('preserves committed state after actual %s write failure and supports retry', async name => {
    const { vault, directory } = await setup(); const before = vault.snapshot(); const target = join(directory, name), held = join(directory, `held-${name}`); const original = await readFile(target);
    await rename(target, held); await mkdir(target);
    try {
      await expect(vault.updateSettings(state => { state.preferences.theme = 'dark'; })).rejects.toThrow('could not be saved');
      expect(vault.snapshot()).toEqual(before); expectBytes(await readFile(held), original);
    } finally { await rm(target, { recursive: true }); await rename(held, target); }
    const next = await vault.updateSettings(state => { state.preferences.theme = 'dark'; });
    expectBytes(await readFile(join(directory, 'workspace.backup.json')), canonical(before)); expectBytes(await readFile(join(directory, 'workspace.json')), canonical(next));
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.preferences().theme).toBe('dark');
  }, diskCaseBudgetMs);
});
