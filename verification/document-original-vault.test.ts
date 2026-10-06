import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { readWorkspaceFile as readFile } from './read-workspace-file';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { attachmentSchema } from '../contracts/attachments';
import { composerDraftSchema } from '../contracts/workspace';
import type { DocumentOriginal } from '../contracts/document-originals';
import { WorkspaceVault } from '../desktop/services/vault';
import { codec, sampleThread, testVault } from './fixtures';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() { const result = await testVault(); directories.push(result.directory); return result; }
const pdf = Buffer.from('%PDF-1.7\noriginal document bytes\n%%EOF');
const attachment = (original: DocumentOriginal) => attachmentSchema.parse({ id: 'pdf', name: 'original.pdf', content: 'Extracted text', source: { format: 'pdf', bytes: original.bytes }, original });

describe('original documents in workspace transactions', () => {
  it('persists exact original bytes before acknowledging a composer save and restores them after restart', async () => {
    const { vault, directory } = await fixture(); const [ref] = vault.stageDocumentOriginals([pdf]);
    await expect(vault.readDocumentOriginal(ref)).rejects.toThrow('no longer belongs');
    await vault.commitComposer(state => { state.composerDrafts.push(composerDraftSchema.parse({ text: '', attachments: [attachment(ref)], updatedAt: 1 })); });
    expect(await readFile(join(directory, 'document-originals', ref.sha256))).toEqual(pdf);
    expect(await vault.readDocumentOriginal(ref)).toEqual(pdf);
    const workspace = await readFile(join(directory, 'workspace.json'), 'utf8');
    expect(workspace).not.toContain(pdf.toString('base64')); expect(workspace).not.toContain('original document bytes');
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(await restarted.readDocumentOriginal(ref)).toEqual(pdf);
    const controller = new AbortController(); controller.abort();
    await expect(restarted.readDocumentOriginal(ref, controller.signal)).rejects.toThrow();
    await restarted.commitComposer(state => { state.composerDrafts = []; });
    await expect(restarted.readDocumentOriginal(ref)).rejects.toThrow('no longer belongs');
  });

  it('keeps temporary originals off disk and removes access when their last live owner is deleted', async () => {
    const { vault, directory } = await fixture(); const before = await readFile(join(directory, 'workspace.json'));
    const [ref] = vault.stageDocumentOriginals([pdf]);
    await vault.commit(state => {
      state.threads.push(sampleThread({ temporary: true }));
      state.composerDrafts.push(composerDraftSchema.parse({ threadId: 'thread', text: '', attachments: [attachment(ref)], updatedAt: 1 }));
    });
    expect(await vault.readDocumentOriginal(ref)).toEqual(pdf);
    expect(await readFile(join(directory, 'workspace.json'))).toEqual(before);
    expect(await readdir(directory)).not.toContain('document-originals');
    expect(vault.backup().composerDrafts).toEqual([]);
    await vault.commit(state => { state.threads = []; state.composerDrafts = []; });
    await expect(vault.readDocumentOriginal(ref)).rejects.toThrow('no longer belongs');
    expect(await readdir(directory)).not.toContain('document-originals');
  });

  it('promotes shared temporary originals to durable ownership and retains them for remaining owners', async () => {
    const { vault, directory } = await fixture(); const [ref] = vault.stageDocumentOriginals([pdf]);
    await vault.commit(state => {
      state.threads.push(sampleThread({ temporary: true }));
      state.composerDrafts.push(composerDraftSchema.parse({ threadId: 'thread', text: '', attachments: [attachment(ref)], updatedAt: 1 }));
    });
    await vault.commit(state => { state.threads.push(sampleThread({ id: 'saved', messages: [{ id: 'message', role: 'user', content: '', status: 'complete', attachments: [attachment(ref)], createdAt: 1 }] })); });
    expect(await readdir(join(directory, 'document-originals'))).toEqual([ref.sha256]);
    await vault.commit(state => { state.threads = state.threads.filter(thread => !thread.temporary); state.composerDrafts = []; });
    expect(await vault.readDocumentOriginal(ref)).toEqual(pdf);
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    expect(await restarted.readDocumentOriginal(ref)).toEqual(pdf);
    expect(restarted.snapshot().threads.map(thread => thread.id)).toEqual(['saved']);
  });

  it('leaves workspace state unchanged after a failed save and keeps staged originals available for retry', async () => {
    const { vault, directory } = await fixture(); const [ref] = vault.stageDocumentOriginals([pdf]);
    const before = vault.snapshot(), primary = await readFile(join(directory, 'workspace.json'));
    const backup = join(directory, 'workspace.backup.json.gz'), retained = join(directory, 'retained-backup.json');
    await rename(backup, retained); await mkdir(backup);
    const save = () => vault.commitComposer(state => { state.composerDrafts.push(composerDraftSchema.parse({ text: '', attachments: [attachment(ref)], updatedAt: 1 })); });
    try {
      await expect(save()).rejects.toThrow('Local data');
      expect(vault.snapshot()).toEqual(before); expect(await readFile(join(directory, 'workspace.json'))).toEqual(primary);
      await expect(vault.readDocumentOriginal(ref)).rejects.toThrow('no longer belongs');
    } finally { await rm(backup, { recursive: true }); await rename(retained, backup); }
    await save(); expect(await vault.readDocumentOriginal(ref)).toEqual(pdf);
  });

  it('rejects unavailable new originals before committing and reports later corruption without blocking workspace startup', async () => {
    const { vault, directory } = await fixture(); const [ref] = vault.stageDocumentOriginals([pdf]);
    const missing = { ...ref, sha256: '0'.repeat(64) }; const before = vault.snapshot();
    await expect(vault.commitComposer(state => { state.composerDrafts.push(composerDraftSchema.parse({ text: '', attachments: [attachment(missing)], updatedAt: 1 })); })).rejects.toThrow('missing or damaged');
    expect(vault.snapshot()).toEqual(before);
    await vault.commitComposer(state => { state.composerDrafts.push(composerDraftSchema.parse({ text: '', attachments: [attachment(ref)], updatedAt: 1 })); });
    await writeFile(join(directory, 'document-originals', ref.sha256), Buffer.alloc(pdf.length));
    const restarted = new WorkspaceVault(directory, codec); await restarted.initialize();
    await expect(restarted.readDocumentOriginal(ref)).rejects.toThrow('missing or damaged');
    await restarted.commitComposer(state => { state.composerDrafts = []; });
    await expect(restarted.readDocumentOriginal(ref)).rejects.toThrow('no longer belongs');
  });
});
