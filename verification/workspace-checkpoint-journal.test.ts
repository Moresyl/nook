import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readWorkspaceFile as readFile } from './read-workspace-file';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceVault } from '../desktop/services/vault';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { composerDraftSchema, type Message } from '../contracts/workspace';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename), stat: vi.fn(actual.stat), rm: vi.fn(actual.rm) }; });
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  vi.mocked(rename).mockReset().mockImplementation(actual.rename); vi.mocked(stat).mockReset().mockImplementation(actual.stat); vi.mocked(rm).mockReset().mockImplementation(actual.rm);
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});
const message = (content: string, status: Message['status'] = 'complete'): Message => ({ id: 'reply', role: 'assistant', content, status, attachments: [], createdAt: 1 });
const quickState = (text: string) => ({ revision: randomUUID(), activeThreadId: 'thread', composerDrafts: [composerDraftSchema.parse({ threadId: 'thread', text, updatedAt: 1 })] });
async function fixture() {
  const { vault, directory } = await testVault(); directories.push(directory);
  await vault.update(draft => { draft.threads.push(sampleThread({ messages: [message('Before')] })); });
  return { vault, directory, primary: join(directory, 'workspace.json'), backup: join(directory, 'workspace.backup.json.gz'), journal: join(directory, 'workspace.checkpoints.json') };
}

describe('durable response checkpoint journal', () => {
  it('journals a quick draft without replacing unrelated large history and retains exact backup, restart and flush bytes', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.update(draft => { draft.threads.push(sampleThread({ id: 'large', messages: [message('Unchanged 中文 😀\n'.repeat(50_000))] })); });
    const original = await readFile(primary), quickChat = quickState('Quick 未发送 😀');
    await vault.commitQuickChat(draft => { draft.quickChat = quickChat; });
    expect((await readFile(primary)).equals(original)).toBe(true); expect((await readFile(backup)).equals(original)).toBe(true);
    const saved = JSON.parse(await readFile(journal, 'utf8')); expect(saved.schemaVersion).toBe(3); expect(saved.quickChat).toEqual(quickChat);
    expect(saved.threads).toEqual([]); expect((await stat(journal)).size).toBeLessThan(10_000);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(vault.snapshot());
    await restored.flush(); expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 10_000); // This new filesystem roundtrip includes large fixture setup, full backup, restart and canonical flush; existing application and held-operation waits are unchanged.
  it('atomically clears quick-chat state without reviving its saved predecessor after restart or flush', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('Retained before clearing'); });
    await vault.flush(); const original = await readFile(primary), previous = vault.snapshot();
    await vault.commitQuickChat(draft => { draft.quickChat = undefined; });
    expect(await readFile(primary)).toEqual(original); expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(previous, null, 2));
    expect(JSON.parse(await readFile(journal, 'utf8')).quickChat).toBeNull();
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.quickChat()).toBeUndefined();
    await restored.flush(); expect(JSON.parse(await readFile(primary, 'utf8')).quickChat).toBeUndefined();
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains independent main and quick drafts across reply checkpoints and consumes only the quick draft when continuing', async () => {
    const { vault, directory, primary, backup, journal } = await fixture(); const original = await readFile(primary);
    await new ComposerDrafts(vault).save(composerDraftSchema.parse({ threadId: 'thread', text: 'Main retained', updatedAt: 1 }));
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('Quick question'); });
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Checkpoint reply') }]); const previous = vault.snapshot();
    await vault.commit(draft => {
      draft.threads[0].messages.push({ ...message('Quick question'), id: 'question', role: 'user' });
      draft.quickChat = quickState('');
    }, { conversation: true });
    expect(await readFile(primary)).toEqual(original); expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(previous, null, 2));
    const saved = JSON.parse(await readFile(journal, 'utf8')); expect(saved.schemaVersion).toBe(3);
    expect(saved.composer.composerDrafts[0].text).toBe('Main retained'); expect(saved.quickChat.composerDrafts[0].text).toBe('');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(vault.snapshot());
  });
  it('preserves the previous quick revision and journal through an actual replacement failure and retries exactly', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('Previous quick'); });
    const before = vault.snapshot(), original = await readFile(primary), saved = await readFile(journal);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === journal) throw Object.assign(new Error('PRIVATE_QUICK_EIO'), { code: 'EIO' }); return actual.rename(from, to); });
    const next = quickState('Unacknowledged quick');
    await expect(vault.commitQuickChat(draft => { draft.quickChat = next; })).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(original); expect(await readFile(journal)).toEqual(saved);
    expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(before, null, 2));
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(before);
    vi.mocked(rename).mockImplementation(actual.rename); await vault.commitQuickChat(draft => { draft.quickChat = next; });
    const retried = new WorkspaceVault(directory, codec); await retried.initialize(); expect(retried.quickChat()).toEqual(next);
  });
  it('materializes a quick save when identical primary bytes have been externally replaced, retaining the exact prior backup', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('Previous quick'); });
    const previous = vault.snapshot(), original = await readFile(primary);
    await rename(primary, join(directory, 'retired-quick-primary.json')); await writeFile(primary, original);
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('Latest quick'); });
    expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(previous, null, 2)); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(vault.snapshot());
  });
  it('falls back to a complete durable save when independent quick drafts exceed the unchanged journal size limit', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    const owners = Array.from({ length: 45 }, (_, index) => `quick-owner-${index}`);
    await vault.update(draft => { draft.threads.push(...owners.map(id => sampleThread({ id, messages: [] }))); });
    const previous = vault.snapshot();
    const quickChat = { revision: randomUUID(), composerDrafts: owners.map(threadId => composerDraftSchema.parse({ threadId, text: '保留'.repeat(100_000), updatedAt: 1 })) };
    await vault.commitQuickChat(draft => { draft.quickChat = quickChat; });
    expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(previous, null, 2)); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.quickChat()).toEqual(quickChat);
  });
  it.each(['owner', 'active', 'duplicate', 'legacy1', 'legacy2', 'revision'])('rejects malformed quick journal metadata (%s), preserving both files and hiding private contents', async kind => {
    const { vault, directory, primary, journal } = await fixture();
    await vault.commitQuickChat(draft => { draft.quickChat = quickState('PRIVATE_QUICK_DRAFT_BODY'); });
    const original = await readFile(primary), saved = JSON.parse(await readFile(journal, 'utf8'));
    if (kind === 'owner') saved.quickChat.composerDrafts[0].threadId = 'missing';
    if (kind === 'active') saved.quickChat.activeThreadId = 'missing';
    if (kind === 'duplicate') saved.quickChat.composerDrafts.push(saved.quickChat.composerDrafts[0]);
    if (kind === 'legacy1') saved.schemaVersion = 1;
    if (kind === 'legacy2') saved.schemaVersion = 2;
    if (kind === 'revision') saved.quickChat.revision = 'PRIVATE_INVALID_REVISION';
    await writeFile(journal, JSON.stringify(saved)); const malformed = await readFile(journal);
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Saved response checkpoints could not be read');
    expect(await readFile(primary)).toEqual(original); expect(await readFile(journal)).toEqual(malformed);
  });
  it('saves composer metadata without re-encoding unrelated history and retains exact backup and restart state', async () => {
    const { vault, directory, primary, backup } = await fixture();
    await vault.update(draft => { draft.threads.push(sampleThread({ id: 'large', messages: [message('Unchanged 中文 😀\n'.repeat(50_000))] })); });
    const before = await readFile(primary);
    const stringify = vi.spyOn(JSON, 'stringify');
    let encodedUnchanged: boolean;
    try {
      await new ComposerDrafts(vault).save({ threadId: 'thread', text: 'New draft', attachments: [], model: 'fixture', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 });
      encodedUnchanged = stringify.mock.calls.some(([value]) => value && typeof value === 'object' && 'id' in value && value.id === 'large');
    } finally { stringify.mockRestore(); }
    expect(encodedUnchanged).toBe(false);
    expect((await readFile(primary)).equals(before)).toBe(true); expect((await readFile(backup)).equals(before)).toBe(true);
    const recovered = new WorkspaceVault(directory, codec); await recovered.initialize();
    expect(recovered.snapshot()).toEqual(vault.snapshot());
    await recovered.flush(); expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
  });
  it('rejects a composer save when its primary path has become a directory, without acknowledging an unusable journal', async () => {
    const { vault, directory, primary, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('Previous') }]);
    const before = vault.snapshot(), saved = await readFile(journal), held = join(directory, 'held-primary.json');
    await rename(primary, held); await mkdir(primary);
    await expect(new ComposerDrafts(vault).save({ threadId: 'thread', text: 'Unsaved', attachments: [], model: 'fixture', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 })).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(journal)).toEqual(saved); expect((await stat(primary)).isDirectory()).toBe(true);
    await rm(primary, { recursive: true }); await rename(held, primary);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(before);
  });
  it('falls back to an independent full transaction when the primary file has been externally replaced with identical bytes', async () => {
    const { vault, directory, primary, journal } = await fixture(); const original = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Previous') }]);
    await rename(primary, join(directory, 'retired-primary.json')); await writeFile(primary, original);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Latest') }]);
    expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(vault.snapshot());
  });
  it('recovers actual composer saves and active-owner clearing with exact independent backups, then materializes canonical bytes', async () => {
    const { vault, directory, primary, backup, journal } = await fixture(); const original = await readFile(primary);
    const drafts = new ComposerDrafts(vault);
    await drafts.save({ threadId: 'thread', text: '未发送 🧪', attachments: [], model: 'fixture', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 });
    expect(await readFile(primary)).toEqual(original); expect(await readFile(backup)).toEqual(original);
    const savedDraft = vault.snapshot(); await drafts.activate('thread');
    expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(savedDraft, null, 2));
    await drafts.activate(); const expected = vault.snapshot();
    const recovered = new WorkspaceVault(directory, codec); await recovered.initialize(); expect(recovered.snapshot()).toEqual(expected);
    expect(recovered.snapshot().activeThreadId).toBeUndefined(); expect((await readFile(journal, 'utf8')).includes('未发送 🧪')).toBe(true);
    await recovered.flush(); expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(expected, null, 2));
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retains draft metadata across response checkpoints and clears it atomically when continuing an existing conversation', async () => {
    const { vault, directory, primary, backup, journal } = await fixture(); const original = await readFile(primary);
    await new ComposerDrafts(vault).save({ threadId: 'thread', text: 'Question', attachments: [], model: 'fixture', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 });
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Reply') }]); const before = vault.snapshot();
    await vault.update(draft => { draft.threads[0].messages.push({ ...message('Next question'), id: 'question', role: 'user' }); draft.composerDrafts = []; }, { conversation: true });
    expect(await readFile(primary)).toEqual(original); expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(before, null, 2));
    const recovered = new WorkspaceVault(directory, codec); await recovered.initialize(); expect(recovered.snapshot()).toEqual(vault.snapshot());
    expect(JSON.parse(await readFile(journal, 'utf8')).schemaVersion).toBe(2);
  });
  it.each(['append', 'remove', 'reorder', 'preferences'])('falls back to the original full-file transaction for structural or unrelated changes (%s)', async change => {
    const { vault, directory, primary, journal } = await fixture();
    await vault.update(draft => { draft.threads.push(sampleThread({ id: 'second' })); });
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Saved') }]);
    await vault.update(draft => {
      if (change === 'append') draft.threads.push(sampleThread({ id: 'third' }));
      if (change === 'remove') draft.threads.pop();
      if (change === 'reorder') draft.threads.reverse();
      if (change === 'preferences') draft.preferences.theme = 'dark';
    }, { conversation: true });
    expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    const recovered = new WorkspaceVault(directory, codec); await recovered.initialize(); expect(recovered.snapshot()).toEqual(vault.snapshot());
  });
  it('does not materialize a pending journal on a no-op conversation activation', async () => {
    const { vault, primary, journal } = await fixture(); await vault.update(draft => { draft.activeThreadId = 'thread'; });
    const original = await readFile(primary); await vault.checkpointMessages([{ threadId: 'thread', message: message('Saved') }]);
    const saved = await readFile(journal); await new ComposerDrafts(vault).activate('thread');
    expect(await readFile(primary)).toEqual(original); expect(await readFile(journal)).toEqual(saved);
  });
  it('keeps a failed draft journal unpublished and retries without losing the previous response checkpoint', async () => {
    const { vault, directory, primary, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('Saved') }]);
    const before = vault.snapshot(), original = await readFile(primary), saved = await readFile(journal);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementationOnce(async (from, to) => actual.rename(from, to)).mockRejectedValueOnce(Object.assign(new Error('Disk unavailable'), { code: 'EIO' }));
    const change = (draft: ReturnType<WorkspaceVault['snapshot']>) => { draft.activeThreadId = 'thread'; };
    await expect(vault.update(change, { conversation: true })).rejects.toThrow();
    expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(original); expect(await readFile(journal)).toEqual(saved);
    const recovered = new WorkspaceVault(directory, codec); await recovered.initialize(); expect(recovered.snapshot()).toEqual(before);
    await vault.update(change, { conversation: true });
    const retried = new WorkspaceVault(directory, codec); await retried.initialize(); expect(retried.snapshot()).toEqual(vault.snapshot());
  });
  it.each(['owner', 'active', 'duplicate', 'legacy'])('rejects malformed draft journal metadata (%s) without disclosing its contents', async kind => {
    const { vault, directory, journal } = await fixture();
    await new ComposerDrafts(vault).save({ threadId: 'thread', text: 'PRIVATE_DRAFT_BODY', attachments: [], model: 'fixture', mode: 'chat', mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 });
    const saved = JSON.parse(await readFile(journal, 'utf8'));
    if (kind === 'owner') saved.composer.composerDrafts[0].threadId = 'missing';
    if (kind === 'active') saved.composer.activeThreadId = 'missing';
    if (kind === 'duplicate') saved.composer.composerDrafts.push(saved.composer.composerDrafts[0]);
    if (kind === 'legacy') saved.schemaVersion = 1;
    const bytes = JSON.stringify(saved); await writeFile(journal, bytes);
    let failure: unknown; try { await new WorkspaceVault(directory, codec).initialize(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error); expect((failure as Error).message).not.toContain('PRIVATE_DRAFT_BODY'); expect((failure as Error).cause).toBeUndefined();
    expect(await readFile(journal, 'utf8')).toBe(bytes);
  });
  it('commits the exact previous backup and a recoverable checkpoint without replacing the full primary; flush materializes exact canonical bytes', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    const before = await readFile(primary); const primaryId = (await stat(primary, { bigint: true })).ino;
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Unicode 部分 🧪') }]);
    expect(await readFile(primary)).toEqual(before); expect((await stat(primary, { bigint: true })).ino).toBe(primaryId);
    expect(await readFile(backup)).toEqual(before); expect((await readFile(journal, 'utf8'))).toContain('Unicode 部分 🧪');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0].content).toBe('Unicode 部分 🧪');
    await vault.flush(); expect(await readFile(primary, 'utf8')).toBe(JSON.stringify(vault.snapshot(), null, 2));
    expect(await readFile(backup)).toEqual(before); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('ignores a retired journal when an independent atomic replacement has identical primary bytes', async () => {
    const { vault, directory, primary, journal } = await fixture();
    const before = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Must not replay') }]);
    const replacement = `${primary}.replacement`; await writeFile(replacement, before); await rename(replacement, primary);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0].content).toBe('Before');
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('waits for the queued durable checkpoint without materializing the primary or announcing unsaved state', async () => {
    const { vault, primary, journal } = await fixture(); const before = await readFile(primary);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let release!: () => void; let started!: () => void; const held = new Promise<void>(resolve => { release = resolve; }); const entered = new Promise<void>(resolve => { started = resolve; });
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === journal) { started(); await held; } return actual.rename(from, to); });
    const saving = vault.checkpointMessages([{ threadId: 'thread', message: message('Committed') }]);
    try {
      await entered; let settled = false; const waiting = vault.wait().then(() => { settled = true; });
      await Promise.resolve(); expect(settled).toBe(false); expect(vault.snapshot().threads[0].messages[0].content).toBe('Before');
      release(); await saving; await waiting; expect(settled).toBe(true); expect(vault.snapshot().threads[0].messages[0].content).toBe('Committed');
      expect(await readFile(primary)).toEqual(before);
    } finally { release(); await saving; }
  });
  it('ignores retired checkpoints after a successful save restores identical base bytes even when journal cleanup fails', async () => {
    const { vault, directory, primary, journal } = await fixture(); const before = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Retired') }]);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rm).mockImplementation(async (path, options) => { if (path === journal) throw Object.assign(new Error('Cleanup unavailable'), { code: 'EACCES' }); return actual.rm(path, options); });
    await vault.update(draft => { draft.threads[0] = sampleThread({ messages: [message('Before')] }); });
    expect((await readFile(primary)).equals(before)).toBe(true); expect((await readFile(journal, 'utf8')).includes('Retired')).toBe(true);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().threads[0].messages[0].content).toBe('Before');
  });
  it('bounds a journal that grows between its size check and reading, and retains both private files on recovery failure', async () => {
    const { directory, primary, journal } = await fixture(); const before = await readFile(primary);
    await writeFile(journal, Buffer.alloc(8 * 1024 * 1024 + 1, 32)); const info = await stat(journal); Object.defineProperty(info, 'size', { value: 0 });
    vi.mocked(stat).mockResolvedValueOnce(info);
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Saved response checkpoints could not be read');
    expect(await readFile(primary)).toEqual(before); expect((await stat(journal)).size).toBe(8 * 1024 * 1024 + 1);
  });
  it('retains committed data through actual journal replacement failure and permits an exact retry', async () => {
    const { vault, primary, backup, journal } = await fixture(); const before = vault.snapshot(); const bytes = await readFile(primary);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === journal) throw Object.assign(new Error('PRIVATE_JOURNAL_IO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.checkpointMessages([{ threadId: 'thread', message: message('Rejected') }])).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(primary)).toEqual(bytes); expect(await readFile(backup)).toEqual(bytes);
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    vi.mocked(rename).mockImplementation(actual.rename);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Retry') }]); expect(vault.snapshot().threads[0].messages[0].content).toBe('Retry');
  });
  it('preserves the authoritative journal and exact previous backup through a failed ordinary save, then resets it on retry', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Journal committed') }]);
    const before = vault.snapshot(); const checkpoint = await readFile(journal);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === primary) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.update(draft => { draft.threads[0].title = 'Failed'; })).rejects.toThrow('Local data could not be saved');
    expect(vault.snapshot()).toEqual(before); expect(await readFile(journal)).toEqual(checkpoint); expect(await readFile(backup, 'utf8')).toBe(JSON.stringify(before, null, 2));
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot()).toEqual(before);
    vi.mocked(rename).mockImplementation(actual.rename);
    await vault.update(draft => { draft.threads[0].title = 'Retried'; });
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].title).toBe('Retried'); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('keeps a checkpoint recoverable when materialization fails and preserves the prior backup on successful retry', async () => {
    const { vault, primary, backup, journal } = await fixture(); const previous = await readFile(primary);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Retained') }]);
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    vi.mocked(rename).mockImplementation(async (from, to) => { if (to === primary) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return actual.rename(from, to); });
    await expect(vault.flush()).rejects.toThrow('Local data could not be saved'); expect((await readFile(journal, 'utf8')).includes('Retained')).toBe(true);
    expect(await readFile(primary)).toEqual(previous); vi.mocked(rename).mockImplementation(actual.rename);
    await vault.flush(); expect(await readFile(backup)).toEqual(previous); expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content).toBe('Retained');
  });
  it('excludes temporary checkpoints from both persistent files and the journal while retaining the live temporary message', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.update(draft => { draft.threads.push(sampleThread({ id: 'temporary', temporary: true, messages: [message('PRIVATE_TEMP_BEFORE')] })); });
    await vault.checkpointMessages([{ threadId: 'temporary', message: message('PRIVATE_TEMP_AFTER') }, { threadId: 'thread', message: message('Regular') }]);
    for (const path of [primary, backup, journal]) expect((await readFile(path, 'utf8')).includes('PRIVATE_TEMP')).toBe(false);
    expect(vault.snapshot().threads[1].messages[0].content).toBe('PRIVATE_TEMP_AFTER');
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().threads).toHaveLength(1); expect(restored.snapshot().threads[0].messages[0].content).toBe('Regular');
  });
  it('recovers running text after an abrupt exit and materializes stopped status with the exact running checkpoint as backup', async () => {
    const { vault, directory, primary, backup, journal } = await fixture();
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Abrupt partial', 'running') }]); const running = JSON.stringify(vault.snapshot(), null, 2);
    const restored = new WorkspaceVault(directory, codec); await restored.initialize();
    expect(restored.snapshot().threads[0].messages[0]).toMatchObject({ content: 'Abrupt partial', status: 'stopped' });
    expect(await readFile(backup, 'utf8')).toBe(running); expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].status).toBe('stopped');
    await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.each(['owner', 'duplicate', 'index', 'temporary', 'syntax'])('rejects a malformed bound journal (%s) without logging private data or altering any stored bytes', async kind => {
    const { vault, directory, primary, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('PRIVATE_CHECKPOINT_TEXT') }]);
    const saved = JSON.parse(await readFile(journal, 'utf8'));
    if (kind === 'owner') saved.threads[0].thread.id = 'missing';
    if (kind === 'duplicate') saved.threads.push(saved.threads[0]);
    if (kind === 'index') saved.threads[0].index = 9999;
    if (kind === 'temporary') saved.threads[0].thread.temporary = true;
    await writeFile(journal, kind === 'syntax' ? '{PRIVATE_INVALID_CHECKPOINT' : JSON.stringify(saved));
    const bytes = await readFile(journal); const base = await readFile(primary);
    const restored = new WorkspaceVault(directory, codec); const error = await restored.initialize().catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(error.message).toContain('Saved response checkpoints could not be read'); expect(error.cause).toBeUndefined();
    expect(await readFile(journal)).toEqual(bytes); expect(await readFile(primary)).toEqual(base);
  });
  it('ignores a journal with a different valid base digest and preserves the current primary revision', async () => {
    const { vault, directory, journal } = await fixture(); await vault.checkpointMessages([{ threadId: 'thread', message: message('Stale') }]);
    const saved = JSON.parse(await readFile(journal, 'utf8')); saved.baseSha256 = 'a'.repeat(64); await writeFile(journal, JSON.stringify(saved));
    const restored = new WorkspaceVault(directory, codec); await restored.initialize(); expect(restored.snapshot().threads[0].messages[0].content).toBe('Before');
  });
  it('uses ordinary atomic persistence when a filesystem cannot provide an independent primary file identity', async () => {
    const { vault, primary, journal } = await fixture(); const info = await stat(primary, { bigint: true });
    Object.defineProperty(info, 'ino', { value: 0n }); vi.mocked(stat).mockResolvedValueOnce(info as unknown as Awaited<ReturnType<typeof stat>>);
    await vault.checkpointMessages([{ threadId: 'thread', message: message('Fallback') }]);
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content).toBe('Fallback'); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('falls back to the full primary for an oversized active history and rejects oversized recovery files before parsing', async () => {
    const { vault, directory, primary, journal } = await fixture();
    await vault.update(draft => { draft.threads[0].messages = Array.from({ length: 3 }, (_, index) => ({ ...message('x'.repeat(3000000)), id: index ? `other-${index}` : 'reply' })); });
    await vault.checkpointMessages([{ threadId: 'thread', message: message('y'.repeat(3000000)) }]);
    expect(JSON.parse(await readFile(primary, 'utf8')).threads[0].messages[0].content.length).toBe(3000000); await expect(readFile(journal)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(journal, Buffer.alloc(8 * 1024 * 1024 + 1, 32));
    await expect(new WorkspaceVault(directory, codec).initialize()).rejects.toThrow('Saved response checkpoints could not be read');
  });
});
