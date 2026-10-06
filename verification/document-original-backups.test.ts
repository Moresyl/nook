import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composerDraftSchema } from '../contracts/workspace';
import { randomUUID } from 'node:crypto';
import { validateDocumentOriginalBundles } from '../desktop/services/document-original-backups';
import { originalDocumentIdentity } from '../desktop/services/document-original-store';
import { ExtensionSettings } from '../desktop/services/extension-settings';
import { LocalSkills } from '../desktop/services/local-skills';
import { WorkspaceBackupFiles } from '../desktop/services/backup-files';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const bytes = Buffer.from('%PDF-1.7\nexact original\n%%EOF');
const reference = originalDocumentIdentity(bytes);
const bundle = { reference, data: bytes.toString('base64') };
async function fixture() {
  const result = await testVault(); directories.push(result.directory);
  return { ...result, settings: new ExtensionSettings(result.vault, new LocalSkills(join(result.directory, 'skills'))) };
}
async function attach(vault: WorkspaceVault, temporary = false) {
  const [original] = vault.stageDocumentOriginals([bytes]);
  await vault.commit(state => {
    if (temporary) state.threads.push(sampleThread({ temporary: true }));
    state.composerDrafts.push(composerDraftSchema.parse({ threadId: temporary ? 'thread' : undefined, text: '', updatedAt: 1,
      attachments: [{ id: 'original', name: 'original.pdf', content: 'Extracted text', source: { format: 'pdf', bytes: bytes.length }, original }] }));
  });
}

describe('complete original document backups', () => {
  it('restores originals owned only by quick-chat drafts and rejects a missing bundle without replacing current input', async () => {
    const source = await fixture(), target = await fixture(); const [original] = source.vault.stageDocumentOriginals([bytes]);
    const revision = randomUUID();
    await source.vault.commitQuickChat(state => { state.quickChat = { revision, composerDrafts: [composerDraftSchema.parse({ text: 'Quick PDF input', updatedAt: 1,
      attachments: [{ id: 'original', name: 'quick.pdf', content: 'Extracted text', source: { format: 'pdf', bytes: bytes.length }, original }] })] }; });
    const backup = await source.settings.backup(); expect(backup.documentOriginals).toEqual([bundle]);
    await target.settings.restore(backup); expect(await target.vault.readDocumentOriginal(reference)).toEqual(bytes);
    expect(target.vault.quickChat()?.revision).not.toBe(revision); expect(target.vault.quickChat()?.composerDrafts[0].text).toBe('Quick PDF input');
    const before = target.vault.snapshot();
    await expect(target.settings.restore({ ...backup, documentOriginals: [] })).rejects.toThrow(); expect(target.vault.snapshot()).toEqual(before);
    const restarted = new WorkspaceVault(target.directory, codec); await restarted.initialize(); expect(await restarted.readDocumentOriginal(reference)).toEqual(bytes);
  });
  it('validates exact owner sets, canonical byte encoding and content integrity while accepting legacy backups', () => {
    expect(validateDocumentOriginalBundles({}, [])).toEqual([]);
    expect(validateDocumentOriginalBundles({ documentOriginals: [bundle] }, [reference])).toEqual([bundle]);
    for (const documentOriginals of [[], [bundle, bundle], [{ ...bundle, reference: { ...reference, bytes: reference.bytes + 1 } }],
      [{ ...bundle, data: bundle.data.slice(0, -1) }], [{ ...bundle, data: Buffer.alloc(bytes.length).toString('base64') }],
      [{ ...bundle, data: Buffer.from('%PDF-1.7\nEXACT original\n%%EOF').toString('base64') }]]) {
      expect(() => validateDocumentOriginalBundles({ documentOriginals }, [reference])).toThrow();
    }
    expect(() => validateDocumentOriginalBundles({ documentOriginals: [bundle] }, [])).toThrow();
  });

  it('round trips exact bytes through gzip into a separate workspace and restart without retaining temporary originals', async () => {
    const source = await fixture(), target = await fixture(); await attach(source.vault);
    const backup = await source.settings.backup(); expect(backup.documentOriginals).toEqual([bundle]);
    const files = new WorkspaceBackupFiles(); const path = join(source.directory, 'complete.json.gz');
    await files.write(path, backup); const raw = await files.read(path); await files.shutdown();
    await target.settings.restore(raw); expect(await target.vault.readDocumentOriginal(reference)).toEqual(bytes);
    const restarted = new WorkspaceVault(target.directory, codec); await restarted.initialize();
    expect(await restarted.readDocumentOriginal(reference)).toEqual(bytes);
    const temporary = await fixture(); await attach(temporary.vault, true);
    expect((await temporary.settings.backup()).documentOriginals).toEqual([]);
    expect(await readdir(temporary.directory)).not.toContain('document-originals');
  });

  it('rejects incomplete and damaged backups before creating blob files or changing workspace state', async () => {
    const source = await fixture(), target = await fixture(); await attach(source.vault);
    const backup = await source.settings.backup(), before = target.vault.snapshot();
    await expect(target.settings.restore({ ...backup, documentOriginals: [] })).rejects.toThrow();
    await expect(target.settings.restore({ ...backup, documentOriginals: [{ ...bundle, data: 'A'.repeat(bundle.data.length) }] })).rejects.toThrow();
    const secondBytes = Buffer.from('%PDF-1.7\nsecond original\n%%EOF'), second = originalDocumentIdentity(secondBytes);
    const two = structuredClone(backup);
    two.composerDrafts[0].attachments.push({ ...two.composerDrafts[0].attachments[0], id: 'second', original: second, source: { format: 'pdf', bytes: second.bytes } });
    two.documentOriginals.push({ reference: second, data: Buffer.alloc(second.bytes).toString('base64') });
    await expect(target.settings.restore(two)).rejects.toThrow();
    expect(target.vault.snapshot()).toEqual(before);
    expect(await readdir(target.directory)).not.toContain('document-originals');
    await expect(target.vault.readDocumentOriginal(reference)).rejects.toThrow('no longer belongs');
  });

  it('exports one consistent snapshot ahead of a queued removal and restores old backups without original fields', async () => {
    const source = await fixture(), target = await fixture(); await attach(source.vault);
    const captured = source.vault.backupWithOriginals();
    const removed = source.vault.commitComposer(state => { state.composerDrafts = []; });
    expect((await captured).documentOriginals).toEqual([bundle]); await removed;
    expect((await source.settings.backup()).documentOriginals).toEqual([]);
    const legacy = source.vault.backup(); await target.settings.restore(legacy);
    expect(target.vault.snapshot().composerDrafts).toEqual([]);
    expect(await readdir(target.directory)).not.toContain('document-originals');
  });
});
