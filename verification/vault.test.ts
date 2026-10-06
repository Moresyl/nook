import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { readWorkspaceFile as readFile } from './read-workspace-file';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceVault } from '../desktop/services/vault';
import { mcpServerSchema } from '../contracts/extensions';
import { codec, provider, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { force: true, recursive: true }))); });
async function freshDirectory() { const path = await mkdtemp(join(tmpdir(), 'qiyao-vault-')); directories.push(path); return path; }
describe('local workspace persistence', () => {
  it('reports exact initialization boundaries and stops before later phases on a private malformed workspace', async () => {
    const directory = await freshDirectory(); const phases: string[] = [];
    const vault = new WorkspaceVault(directory, codec); await vault.initialize((phase) => phases.push(phase));
    expect(phases).toEqual(['workspace.read', 'checkpoints.restore', 'workspace.parsed', 'credentials.read', 'credentials.bound', 'persistent-cache.serialize', 'persistent-cache.ready', 'runs.recovered']);
    await writeFile(join(directory, 'workspace.json'), '{PRIVATE_STARTUP_FIXTURE'); phases.length = 0;
    const failed = new WorkspaceVault(directory, codec); await expect(failed.initialize((phase) => phases.push(phase))).rejects.toThrow('Workspace data could not be read');
    expect(phases).toEqual(['workspace.read', 'workspace.opened', 'workspace.bytes-read', 'workspace.closing', 'workspace.loaded', 'workspace.text-decoded']);
  });
  it('distinguishes decoded invalid data from validated data and failed checkpoint recovery without exposing content', async () => {
    const directory = await freshDirectory(); const phases: string[] = [];
    const observe = (phase: string) => phases.push(phase);
    await writeFile(join(directory, 'workspace.json'), JSON.stringify({ schemaVersion: 'PRIVATE_INVALID_SCHEMA' }));
    await expect(new WorkspaceVault(directory, codec).initialize(observe)).rejects.toThrow('Workspace data could not be read');
    expect(phases).toEqual(['workspace.read', 'workspace.opened', 'workspace.bytes-read', 'workspace.closing', 'workspace.loaded', 'workspace.text-decoded', 'workspace.decoded']);
    const vault = new WorkspaceVault(directory, codec);
    await writeFile(join(directory, 'workspace.json'), JSON.stringify(vault.snapshot()));
    await writeFile(join(directory, 'workspace.checkpoints.json'), '{PRIVATE_INVALID_CHECKPOINT');
    phases.length = 0;
    await expect(new WorkspaceVault(directory, codec).initialize(observe)).rejects.toThrow('Saved response checkpoints could not be read');
    expect(phases).toEqual(['workspace.read', 'workspace.opened', 'workspace.bytes-read', 'workspace.closing', 'workspace.loaded', 'workspace.text-decoded', 'workspace.decoded', 'workspace.validated', 'checkpoints.restore']);
    await rm(join(directory, 'workspace.checkpoints.json')); phases.length = 0;
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(observe);
    expect(restored.snapshot()).toEqual(vault.snapshot());
    expect(phases).toEqual(['workspace.read', 'workspace.opened', 'workspace.bytes-read', 'workspace.closing', 'workspace.loaded', 'workspace.text-decoded', 'workspace.decoded', 'workspace.validated', 'checkpoints.restore', 'workspace.parsed', 'credentials.read', 'credentials.bound', 'persistent-cache.serialize', 'persistent-cache.ready', 'runs.recovered']);
  });
  it('restores multibyte text across file-read chunks without rewriting the persisted file', async () => {
    const directory = await freshDirectory();
    const vault = new WorkspaceVault(directory, codec);
    const state = vault.snapshot();
    state.notes.push({ id: 'unicode', title: '跨块文本', content: 'a'.repeat(524287) + '文档🧪\n'.repeat(70000), createdAt: 1 });
    const bytes = Buffer.from(JSON.stringify(state));
    await writeFile(join(directory, 'workspace.json'), bytes);
    await vault.initialize();
    expect(vault.snapshot().notes).toEqual(state.notes);
    expect((await readFile(join(directory, 'workspace.json'))).equals(bytes)).toBe(true);
  });
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
    expect(JSON.parse(await readFile(join(directory, 'workspace.backup.json.gz'), 'utf8')).notes).toHaveLength(1);
    const reloaded = new WorkspaceVault(directory, codec); await reloaded.initialize();
    expect(reloaded.snapshot().notes).toHaveLength(2);
  });
  it('acknowledges commits only after durable ordered writes without exposing mutable transaction state', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    let retained: ReturnType<typeof vault.snapshot> | undefined;
    const committed = vault.commit(state => { retained = state; state.notes.push({ id: 'committed', title: 'Committed', content: 'Keep', createdAt: 1 }); });
    const following = vault.update(state => { expect(state.notes[0].id).toBe('committed'); state.notes.push({ id: 'following', title: 'Following', content: 'Next', createdAt: 2 }); });
    expect(await committed).toBeUndefined();
    const returned = await following;
    retained!.notes.length = 0; returned.notes.length = 0;
    expect(vault.snapshot().notes.map(note => note.id)).toEqual(['committed', 'following']);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(restarted.snapshot()).toEqual(vault.snapshot());
    expect(JSON.parse(await readFile(join(directory, 'workspace.backup.json.gz'), 'utf8')).notes.map((note: { id: string }) => note.id)).toEqual(['committed']);
    await expect(vault.commit(state => { state.schemaVersion = 2 as 1; })).rejects.toThrow();
    expect(vault.snapshot()).toEqual(restarted.snapshot());
  });
  it('keeps update results bound to their own queued transaction and isolated from later checkpoints', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const first = vault.update(state => { state.threads.push(sampleThread()); });
    const second = vault.update(state => { state.threads[0].title = 'Later'; });
    const [before, after] = await Promise.all([first, second]);
    expect(before.threads[0].title).toBe(sampleThread().title);
    expect(after.threads[0].title).toBe('Later');
    const message = { id: 'checkpoint', role: 'assistant' as const, content: 'Kept', status: 'complete' as const, attachments: [], createdAt: 1 };
    await vault.update(state => { state.threads[0].messages.push(message); });
    const checkpoint = await vault.checkpointMessages([{ threadId: 'thread', message: { ...message, content: 'Updated' } }]);
    checkpoint.threads[0].messages.at(-1)!.content = 'Outside mutation';
    expect(vault.snapshot().threads[0].messages.at(-1)!.content).toBe('Updated');
    before.threads.length = 0; after.threads.length = 0;
    expect(vault.snapshot().threads).toHaveLength(1);
  });
  it('detaches snapshots, transaction replies and backups without a whole-workspace clone', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const message = { id: 'bounded', role: 'assistant' as const, content: '中文😀'.repeat(1000), status: 'complete' as const, attachments: [], createdAt: 1 };
    await vault.commit(state => { state.threads.push(sampleThread({ messages: [message] })); });
    const originalClone = globalThis.structuredClone;
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => {
      if (value && typeof value === 'object' && 'schemaVersion' in value && 'threads' in value) throw new Error('Whole-workspace clone');
      return originalClone(value, options);
    }) as typeof structuredClone;
    try {
      const snapshot = vault.snapshot();
      const updated = await vault.update(state => { state.threads[0].title = 'Updated'; });
      const settings = await vault.updateSettings(state => { state.preferences.theme = 'dark'; });
      const checkpoint = await vault.checkpointMessages([{ threadId: 'thread', message: { ...message, content: 'Saved 中文😀' } }]);
      const backup = vault.backup();
      for (const copy of [snapshot, updated, settings, checkpoint, backup]) copy.threads[0].messages[0].content = 'External mutation';
      expect(vault.thread('thread')?.messages[0].content).toBe('Saved 中文😀');
      await vault.flush(); const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
      expect(restarted.snapshot()).toEqual(vault.snapshot());
    } finally { globalThis.structuredClone = originalClone; }
  });
  it('rejects failed commits without changing memory or the primary file, then permits retry', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const before = vault.snapshot(); const primary = join(directory, 'workspace.json');
    const bytes = await readFile(primary); const backup = join(directory, 'workspace.backup.json.gz');
    const retained = join(directory, 'retained-backup.json');
    await rename(backup, retained); await mkdir(backup);
    try {
      await expect(vault.commit(state => { state.notes.push({ id: 'retry', title: 'Retry', content: 'Keep', createdAt: 1 }); })).rejects.toThrow('Local data');
      expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(bytes);
    } finally { await rm(backup, { recursive: true }); await rename(retained, backup); }
    await vault.commit(state => { state.notes.push({ id: 'retry', title: 'Retry', content: 'Keep', createdAt: 1 }); });
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(restarted.snapshot().notes.at(-1)?.id).toBe('retry');
  });
  it('returns isolated current project records without cloning conversation history', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const project = { id: '__proto__', name: 'Project', path: directory, instructions: 'PRIVATE_PROJECT_CONTEXT', createdAt: 1 };
    await vault.update((draft) => { draft.projects.push(project); draft.threads.push(sampleThread()); });
    const originalClone = globalThis.structuredClone;
    const copied: unknown[] = [];
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { copied.push(value); return originalClone(value, options); }) as typeof structuredClone;
    try {
      const found = vault.project(project.id);
      expect(found).toEqual(project);
      expect(found).not.toBe(project);
      found!.name = 'Changed outside the vault';
      expect(vault.project(project.id)).toEqual(project);
      expect(vault.project('toString')).toBeUndefined();
      expect(vault.project('missing')).toBeUndefined();
      expect(copied).toHaveLength(2);
      expect(copied.every((value) => (value as { id?: string }).id === project.id)).toBe(true);
    } finally { globalThis.structuredClone = originalClone; }
    expect(vault.snapshot().threads).toEqual([sampleThread()]);
  });
  it('keeps project reads on the committed revision through queued saves, failure and removal', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const project = { id: 'project', name: 'Before', path: directory, instructions: '', createdAt: 1 };
    await vault.update((draft) => { draft.projects.push(project); });
    const saving = vault.update((draft) => { draft.projects[0].name = 'After'; });
    expect(vault.project(project.id)?.name).toBe('Before');
    await saving;
    expect(vault.project(project.id)?.name).toBe('After');
    await expect(vault.update((draft) => { draft.projects[0].name = ''; })).rejects.toThrow();
    expect(vault.project(project.id)?.name).toBe('After');
    const removing = vault.update((draft) => { draft.projects = []; });
    expect(vault.project(project.id)?.name).toBe('After');
    await removing;
    expect(vault.project(project.id)).toBeUndefined();
  });
  it('returns isolated MCP records and lists without copying conversation history', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    expect(vault.mcpServers()).toEqual([]); expect(vault.mcpServer('missing')).toBeUndefined();
    const server = mcpServerSchema.parse({ id: '__proto__', name: 'Server', transport: 'stdio', command: 'node', args: ['server.mjs'], disabledTools: ['private'] });
    await vault.commit(draft => { draft.mcpServers.push(server); draft.threads.push(sampleThread()); });
    const originalClone = globalThis.structuredClone; const copied: unknown[] = [];
    globalThis.structuredClone = ((value: unknown, options?: StructuredSerializeOptions) => { copied.push(value); return originalClone(value, options); }) as typeof structuredClone;
    try {
      const single = vault.mcpServer(server.id)!; const list = vault.mcpServers();
      expect(single).toEqual(server); expect(list).toEqual([server]);
      single.args.push('outside'); list[0].disabledTools.length = 0; list[0].enabled = false; list.length = 0;
      expect(vault.mcpServer(server.id)).toEqual(server); expect(vault.mcpServers()).toEqual([server]);
      expect(vault.mcpServer('constructor')).toBeUndefined();
      expect(copied.every(value => Array.isArray(value) ? value.every(item => item.id === server.id) : (value as { id?: string }).id === server.id)).toBe(true);
    } finally { globalThis.structuredClone = originalClone; }
    expect(vault.snapshot().threads).toEqual([sampleThread()]);
  });
  it('keeps MCP reads current and committed across edits, rejection, restart and removal', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const server = mcpServerSchema.parse({ id: 'server', name: 'Before', transport: 'stdio', command: 'node' });
    await vault.commit(draft => { draft.mcpServers.push(server); });
    const saving = vault.commit(draft => { draft.mcpServers[0].name = 'After'; draft.mcpServers[0].disabledTools = ['echo']; });
    expect(vault.mcpServer(server.id)).toEqual(server); await saving;
    const updated = { ...server, name: 'After', disabledTools: ['echo'] };
    expect(vault.mcpServers()).toEqual([updated]);
    await expect(vault.commit(draft => { draft.mcpServers[0].command = ''; })).rejects.toThrow();
    expect(vault.mcpServer(server.id)).toEqual(updated);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.mcpServer(server.id)).toEqual(updated);
    const removing = vault.commit(draft => { draft.mcpServers = []; });
    expect(vault.mcpServers()).toEqual([updated]); await removing;
    expect(vault.mcpServer(server.id)).toBeUndefined(); expect(vault.mcpServers()).toEqual([]);
  });
  it('continues after a rejected change without committing invalid data', async () => {
    const directory = await freshDirectory(); const vault = new WorkspaceVault(directory, codec); await vault.initialize();
    await expect(vault.update((draft) => { draft.schemaVersion = 2 as 1; })).rejects.toThrow();
    await vault.update((draft) => { draft.preferences.theme = 'dark'; });
    expect(vault.snapshot().preferences.theme).toBe('dark');
  });
  it('retains exact primary and backup bytes after validation and actual destination failures, then retries from the last committed state', async () => {
    const directory = await freshDirectory(); const vault = new WorkspaceVault(directory, codec);
    await vault.update((draft) => { draft.notes.push({ id: 'one', title: 'First', content: 'Unicode 文档 🧪', createdAt: 1 }); });
    const primary = join(directory, 'workspace.json'); const backup = join(directory, 'workspace.backup.json.gz');
    const before = vault.snapshot(); const primaryBytes = await readFile(primary); const backupBytes = await readFile(backup);
    await expect(vault.update((draft) => { draft.schemaVersion = 2 as 1; })).rejects.toThrow(); expect(await readFile(primary)).toEqual(primaryBytes); expect(await readFile(backup)).toEqual(backupBytes);
    const retained = join(directory, 'workspace-retained.json'); await rename(primary, retained); await mkdir(primary);
    try { await expect(vault.update((draft) => { draft.notes[0].content = 'Failed replacement'; })).rejects.toThrow('Local data'); expect(vault.snapshot()).toEqual(before); expect(await readFile(retained)).toEqual(primaryBytes); expect(await readFile(backup)).toEqual(primaryBytes); }
    finally { await rm(primary, { recursive: true, force: true }); await rename(retained, primary); }
    await vault.update((draft) => { draft.notes[0].content = 'Successful retry 中文'; });
    expect(await readFile(backup)).toEqual(primaryBytes); expect(JSON.parse(await readFile(primary, 'utf8')).notes[0].content).toBe('Successful retry 中文');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot()).toEqual(vault.snapshot());
  });
  it('keeps both persisted files unchanged for no-op and temporary-only updates while retaining credential normalization and later durable writes', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    await vault.setKey(provider.id, 'PRIVATE_TEST_KEY'); const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().providers[0].hasKey).toBe(true);
    const primary = join(directory, 'workspace.json'); const backup = join(directory, 'workspace.backup.json.gz'); const primaryBytes = await readFile(primary); const backupBytes = await readFile(backup);
    await restarted.update(() => {});
    await restarted.update((draft) => { draft.threads.push(sampleThread({ id: 'temporary', temporary: true, messages: [{ id: 'temporary-reply', role: 'assistant', content: 'PRIVATE_TEMPORARY_TEXT', attachments: [], status: 'running', createdAt: 1 }] })); draft.activeThreadId = 'temporary'; });
    expect(await readFile(primary)).toEqual(primaryBytes); expect(await readFile(backup)).toEqual(backupBytes); expect(restarted.snapshot().threads[0].temporary).toBe(true);
    await restarted.update((draft) => { draft.preferences.theme = 'dark'; });
    for (const path of [primary, backup]) { const text = await readFile(path, 'utf8'); expect(text).not.toContain('PRIVATE_TEST_KEY'); expect(text).not.toContain('PRIVATE_TEMPORARY_TEXT'); expect(JSON.parse(text).providers[0].hasKey).toBe(true); }
    const reopened = new WorkspaceVault(directory, codec); await reopened.initialize(); expect(reopened.snapshot().threads).toEqual([]); expect(reopened.snapshot().preferences.theme).toBe('dark');
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
    expect(JSON.parse(await readFile(join(directory, 'workspace.json'), 'utf8')).threads[0].messages[0]).toMatchObject({ status: 'stopped', content: 'Partial' });
    expect(JSON.parse(await readFile(join(directory, 'workspace.backup.json.gz'), 'utf8')).threads[0].messages[0]).toMatchObject({ status: 'running', content: 'Partial' });
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
