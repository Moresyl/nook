import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type AttachmentInput, type Attachment } from '../contracts/attachments';
import { AttachmentImporter } from '../desktop/services/attachment-importer';
import { originalDocumentIdentity } from '../desktop/services/document-original-store';
import { KnowledgeService } from '../desktop/services/knowledge-service';
import { modelMessage } from '../desktop/services/model-attachments';
import { sampleThread, testVault } from './fixtures';

const bytes = Buffer.from('%PDF-1.7\nPRIVATE ORIGINAL BYTES\n%%EOF');
const input = { name: 'report.pdf', data: bytes.toString('base64') };
const parse = async (value: AttachmentInput): Promise<Attachment> => ({ id: value.name, name: value.name, content: 'Budget evidence 42', source: { format: value.name.endsWith('.pdf') ? 'pdf' : 'text', bytes: Buffer.from(value.data, 'base64').length } });
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('original retention at import boundaries', () => {
  it('stages only PDFs after every parser succeeds and keeps exact mixed-batch ordering', async () => {
    const stage = vi.fn((values: Uint8Array[]) => values.map(originalDocumentIdentity));
    const importer = new AttachmentImporter(parse, stage);
    const files = await importer.importInputs([{ name: 'text.txt', data: Buffer.from('text').toString('base64') }, input, { ...input, name: 'copy.pdf' }]);
    expect(stage).toHaveBeenCalledOnce(); expect(stage).toHaveBeenCalledWith([bytes, bytes]);
    expect(files[0].original).toBeUndefined(); expect(files[1].original).toEqual(originalDocumentIdentity(bytes)); expect(files[2].original).toEqual(files[1].original);
    expect(JSON.stringify(files)).not.toContain(input.data);
  });

  it('does not stage partial batches or mismatched parser output and permits retry after a staging error', async () => {
    const stage = vi.fn((values: Uint8Array[]) => values.map(originalDocumentIdentity));
    const parser = vi.fn(parse).mockResolvedValueOnce(await parse(input)).mockRejectedValueOnce(new Error('parse failed'));
    await expect(new AttachmentImporter(parser, stage).importInputs([input, input])).rejects.toThrow('parse failed'); expect(stage).not.toHaveBeenCalled();
    await expect(new AttachmentImporter(async value => ({ ...await parse(value), source: { format: 'pdf', bytes: 5 } }), stage).importInputs([input])).rejects.toThrow('does not match');
    expect(stage).not.toHaveBeenCalled();
    stage.mockImplementationOnce(() => { throw new Error('memory limit'); }); const importer = new AttachmentImporter(parse, stage);
    await expect(importer.importInputs([input])).rejects.toThrow('memory limit'); expect((await importer.importInputs([input]))[0].original).toBeDefined();
  });

  it('retains path imports in knowledge sources and surviving citations without including bytes in model messages', async () => {
    const { vault, directory } = await testVault(); directories.push(directory);
    const path = join(directory, 'report.pdf'); await writeFile(path, bytes);
    const importer = new AttachmentImporter(parse, values => vault.stageDocumentOriginals(values));
    const [file] = await importer.importPaths([path]);
    const service = new KnowledgeService(vault, { embed: vi.fn(async () => []) });
    await service.importDocuments('notes', [file]);
    const note = vault.snapshot().notes[0]; expect(note.source?.original).toEqual(file.original);
    const citation = { citation: 'K1', noteId: note.id, collectionId: 'notes', collectionName: 'Notes', title: note.title, start: 0, end: note.content.length, text: note.content, source: note.source };
    const message = { id: 'user', role: 'user' as const, status: 'complete' as const, content: 'Review', attachments: [file], knowledgeSources: [citation], createdAt: 1 };
    for (const protocol of ['openai', 'anthropic', 'gemini', 'responses'] as const) {
      const payload = JSON.stringify(modelMessage(message, protocol)); expect(payload).toContain('Budget evidence 42'); expect(payload).not.toContain(input.data); expect(payload).not.toContain('PRIVATE ORIGINAL BYTES');
    }
    await vault.commit(state => { state.notes = []; state.threads.push(sampleThread({ messages: [{ ...message, attachments: [] }] })); });
    expect(await vault.readDocumentOriginal(file.original!)).toEqual(bytes);
    expect((await vault.backupWithOriginals()).documentOriginals).toEqual([{ reference: file.original, data: input.data }]);
  });
});
