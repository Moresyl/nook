import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, provider, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function freshDirectory() { const path = await mkdtemp(join(tmpdir(), 'qiyao-vault-')); directories.push(path); return path; }
describe('local workspace persistence', () => {
  it('handles prototype-like credential IDs as plain data', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    expect(vault.key('toString')).toBe(''); await vault.setKey('__proto__', 'private'); expect(vault.key('__proto__')).toBe('private');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.key('__proto__')).toBe('private'); await restarted.setKey('__proto__', ''); expect(restarted.key('__proto__')).toBe('');
  });
  it('flushes queued editor drafts and retains their base revisions in backups and restarts', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const saving = vault.update((draft) => { draft.editorDrafts.push({ projectId: 'project', path: 'file.ts', text: 'Draft', baseText: 'Base', baseSha256: 'a'.repeat(64), updatedAt: 1 }); });
    await vault.flush(); await saving; expect(vault.backup().editorDrafts[0].text).toBe('Draft');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().editorDrafts).toEqual(vault.snapshot().editorDrafts);
  });
  it('serializes concurrent writes, saves backups, and protects snapshots from mutation', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    await Promise.all([vault.update((draft) => { draft.notes.push({ id: 'a', title: 'A', content: 'One', createdAt: 1 }); }), vault.update((draft) => { draft.notes.push({ id: 'b', title: 'B', content: 'Two', createdAt: 2 }); })]);
    expect(vault.snapshot().notes).toHaveLength(2);
    const snapshot = vault.snapshot(); snapshot.notes.length = 0;
    expect(vault.snapshot().notes).toHaveLength(2);
    expect(JSON.parse(await readFile(join(directory, 'workspace.backup.json'), 'utf8')).notes).toHaveLength(1);
    const reloaded = new WorkspaceVault(directory, codec); await reloaded.initialize();
    expect(reloaded.snapshot().notes).toHaveLength(2);
  });
  it('continues after a rejected change without committing invalid data', async () => {
    const directory = await freshDirectory(); const vault = new WorkspaceVault(directory, codec); await vault.initialize();
    await expect(vault.update((draft) => { draft.schemaVersion = 2 as 1; })).rejects.toThrow();
    await vault.update((draft) => { draft.preferences.theme = 'dark'; });
    expect(vault.snapshot().preferences.theme).toBe('dark');
  });
  it('encrypts secrets, excludes credentials from backups, and supports deleting keys', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    await vault.setKey(provider.id, 'super-secret');
    await vault.update((draft) => { draft.providers[0].hasKey = true; });
    expect(vault.key(provider.id)).toBe('super-secret');
    expect(await readFile(join(directory, 'credentials.json'), 'utf8')).not.toContain('super-secret');
    expect(JSON.stringify(vault.backup())).not.toContain('super-secret');
    expect(vault.backup().providers[0].hasKey).toBe(false);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().providers[0].hasKey).toBe(true);
    await vault.setKey(provider.id, ''); expect(vault.key(provider.id)).toBe('');
  });
  it('does not expose encrypted material on decryption errors', async () => {
    const directory = await freshDirectory();
    const vault = new WorkspaceVault(directory, { seal: () => 'secret-ciphertext', open: () => { throw new Error('secret-ciphertext'); } });
    await vault.initialize(); await vault.setKey('p', 'raw-secret');
    expect(() => vault.key('p')).toThrow('system could not decrypt');
    try { vault.key('p'); } catch (error) { expect(String(error)).not.toContain('secret-ciphertext'); }
  });
  it('retains interrupted conversations and marks their running messages stopped', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    await vault.update((draft) => { draft.threads.push(sampleThread({ messages: [{ id: 'a', role: 'assistant', content: 'Partial', createdAt: 1, status: 'running', attachments: [] }] })); });
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0]).toMatchObject({ status: 'stopped', content: 'Partial' });
  });
  it('fails clearly on corrupted workspace data instead of silently overwriting it', async () => {
    const directory = await freshDirectory(); await writeFile(join(directory, 'workspace.json'), '{bad');
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Workspace data could not be read');
    expect(await readFile(join(directory, 'workspace.json'), 'utf8')).toBe('{bad');
  });
  it.each(['null', '[]', '{"p":123}', '{bad'])('rejects corrupted credential stores (%s)', async (stored) => {
    const directory = await freshDirectory(); await writeFile(join(directory, 'credentials.json'), stored);
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Saved credentials could not be read');
  });
});
