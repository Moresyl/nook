import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import { parseOffice, type OfficeParserAST } from 'officeparser';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { attachmentImageUrl, attachmentInputsSchema, attachmentSchema, type Attachment } from '../contracts/attachments';
import { composerRevision } from '../contracts/composer';
import { parseAttachment } from '../desktop/services/attachment-parser';
import { AttachmentImporter, parseInWorker } from '../desktop/services/attachment-importer';
import { modelMessage, validateModelAttachments } from '../desktop/services/model-attachments';
import { modelRequest } from '../desktop/services/model-protocol';
import { HttpModelGateway, type ModelInput } from '../desktop/services/model-gateway';
import { ConversationEngine } from '../desktop/services/conversation-engine';
import { ComposerDrafts } from '../desktop/services/composer-drafts';
import { WorkspaceVault } from '../desktop/services/vault';
import { attachmentInputs } from '../workbench/components/attachments';
import { codec, provider, request, testVault } from './fixtures';
import { documentBytes, imageBytes } from './attachment-fixtures.mjs';

vi.mock('officeparser', async (original) => {
  const module = await original<typeof import('officeparser')>();
  return { ...module, parseOffice: vi.fn(module.parseOffice) };
});

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const input = (name: string, bytes: Buffer) => ({ name, data: bytes.toString('base64') });
const message = (files: Attachment[], content = 'Review files') => ({ id: 'user', role: 'user' as const, content, attachments: files, status: 'complete' as const, createdAt: 1 });
async function image() { return parseAttachment(input('image.png', await imageBytes())); }

describe('attachment ingestion', () => {
  beforeAll(async () => {
    const startedAt = Date.now();
    const bootstrap = await parseAttachment(input('parser-bootstrap.pdf', documentBytes('pdf')));
    expect(bootstrap.content).toContain('Document evidence'); expect(bootstrap.content).toContain('42');
    vi.mocked(parseOffice).mockClear();
    console.info('Attachment parser bootstrap observations', { elapsedMs: Date.now() - startedAt });
  }, 30_000); // Cold PDF initialization gets the existing production worker budget; individual checks keep their normal timeout.
  it.each(['pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'rtf'])('extracts actual %s document text and preserves source details', async (format) => {
    const bytes = documentBytes(format); const file = await parseAttachment(input(`document.${format}`, bytes));
    expect(file.content).toContain('Document evidence'); expect(file.content).toContain('42'); expect(file.source).toEqual({ format, bytes: bytes.length }); expect(file.image).toBeUndefined();
    if (format === 'docx') expect(file.content).toContain('中文');
    if (format === 'pdf') expect(file.content.indexOf('42')).toBeGreaterThan(file.content.indexOf('Document evidence'));
  });
  it('reads UTF-8, UTF-16 with both byte orders, empty files and extensionless text without replacing invalid bytes', async () => {
    expect((await parseAttachment(input('readme.md', Buffer.from('中文 UTF-8')))).content).toBe('中文 UTF-8');
    expect((await parseAttachment(input('notes.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from('中文 UTF-16', 'utf16le')])))).content).toBe('中文 UTF-16');
    const bigEndian = Buffer.from('中文', 'utf16le').swap16(); expect((await parseAttachment(input('notes.txt', Buffer.concat([Buffer.from([254, 255]), bigEndian])))).content).toBe('中文');
    expect((await parseAttachment(input('empty.txt', Buffer.alloc(0)))).content).toBe(''); expect((await parseAttachment(input('README', Buffer.from('Notes')))).content).toBe('Notes');
    await expect(parseAttachment(input('bad.txt', Buffer.from([0xff])))).rejects.toThrow('encoding'); await expect(parseAttachment(input('binary.txt', Buffer.from([0])))).rejects.toThrow('binary');
    await expect(parseAttachment(input('big.txt', Buffer.from('x'.repeat(256_001))))).rejects.toThrow('256,000');
  });
  it.each(['png', 'jpeg', 'webp', 'gif'] as const)('decodes and normalizes real %s images without retaining EXIF metadata', async (format) => {
    const file = await parseAttachment(input(`image.${format}`, await imageBytes(format))); const metadata = await sharp(Buffer.from(file.image!.data, 'base64')).metadata();
    expect(file.image?.mimeType).toBe('image/jpeg'); expect(file.content).toBe(''); expect(file.source?.format).toBe(format); expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined(); expect(metadata.width).toBe(file.image?.width); expect(metadata.height).toBe(file.image?.height); expect(file.warnings?.[0]).toContain('元数据');
    expect(attachmentImageUrl(file)).toMatch(/^data:image\/jpeg;base64,/); expect(attachmentImageUrl({ id: 'f', name: 'text', content: '' })).toBeUndefined();
  });
  it('resizes large images, treats renamed SVG as invalid image input, rejects damaged files and never reports private parser data', async () => {
    const file = await parseAttachment(input('large.png', await imageBytes('png', 2400, 1200))); expect(Math.max(file.image!.width, file.image!.height)).toBe(2000); expect(file.warnings?.some((value) => value.includes('2,000'))).toBe(true);
    await expect(parseAttachment(input('image.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')))).rejects.toThrow('image');
    await expect(parseAttachment(input('private.docx', Buffer.from('PRIVATE_CORRUPT_CONTENT')))).rejects.toThrow('integrity');
    await expect(parseAttachment(input('old.doc', Buffer.from('Old document')))).rejects.toThrow('unsupported');
    await expect(parseAttachment({ name: 'text.txt', data: 'Zh==' })).rejects.toThrow('canonical base64');
    const oversized = input('file.txt', Buffer.alloc(12_000_001)); await expect(parseAttachment(oversized)).rejects.toThrow('12 MB');
    const bomb = zipSync({ 'word/document.xml': strToU8('x'.repeat(32_000_001)) }); await expect(parseAttachment(input('bomb.docx', Buffer.from(bomb)))).rejects.toThrow(/limits|integrity/);
  });
  it('validates persistence shapes and preserves legacy attachments', async () => {
    expect(attachmentSchema.parse({ id: 'old', name: 'old.txt', content: 'Legacy' })).toEqual({ id: 'old', name: 'old.txt', content: 'Legacy' });
    const file = await image(); expect(attachmentSchema.safeParse({ ...file, content: 'Hidden text' }).success).toBe(false); expect(attachmentSchema.safeParse({ ...file, image: { ...file.image, width: 2001 } }).success).toBe(false);
    expect(attachmentSchema.safeParse({ ...file, image: { ...file.image, width: 100 } }).success).toBe(false);
    const oversizedImage = Buffer.from(file.image!.data, 'base64'); const marker = oversizedImage.indexOf(Buffer.from([255, 192])); oversizedImage.writeUInt16BE(9000, marker + 5); expect(attachmentSchema.safeParse({ ...file, image: { ...file.image, data: oversizedImage.toString('base64') } }).success).toBe(false);
    for (const bytes of [[255, 216, 255, 192, 0, 1], [255, 216, 0, 0, 0, 8], [255, 216, 255, 218, 0, 2], [255, 216, 255, 255, 192, 0, 8, 12, 0, 1, 0, 1, 0], [255, 216, 255, 224, 0, 10], [255, 216, 255, 224, 0, 2]]) {
      expect(attachmentSchema.safeParse({ ...file, image: { ...file.image, data: Buffer.from(bytes).toString('base64') } }).success).toBe(false);
    }
    expect(attachmentInputsSchema.safeParse([{ name: '../secret.txt', data: 'eA==' }]).success).toBe(false); expect(attachmentInputsSchema.safeParse(Array.from({ length: 13 }, () => input('text.txt', Buffer.from('x')))).success).toBe(false);
    expect(attachmentInputsSchema.safeParse(Array.from({ length: 3 }, () => input('text.txt', Buffer.alloc(9_000_000)))).success).toBe(false);
    const full = input('full.txt', Buffer.alloc(12_000_000)); expect(attachmentInputsSchema.safeParse([full, full]).success).toBe(true); expect(attachmentInputsSchema.safeParse([full, full, input('extra.txt', Buffer.from('x'))]).success).toBe(false);
    const largeImage = Buffer.alloc(2_000_001); Buffer.from(file.image!.data, 'base64').copy(largeImage); expect(attachmentSchema.safeParse({ ...file, image: { ...file.image, data: largeImage.toString('base64') } }).success).toBe(false);
    for (const data of ['A', 'Z===', 'Zg=A', 'Zm9=', 'Zg=!']) expect(attachmentInputsSchema.safeParse([{ name: 'file.txt', data }]).success).toBe(false);
  });
  it('fails clearly on encryption, resource limits, empty extraction, oversized extraction and partial document recovery', async () => {
    const parser = vi.mocked(parseOffice); const raw = input('private.pdf', documentBytes('pdf'));
    for (const [code, expected] of [['PASSWORD_REQUIRED', 'password protected'], ['PASSWORD_INCORRECT', 'password protected'], ['DOCUMENT_DECRYPTION_FAILED', 'password protected'], ['XML_ELEMENT_LIMIT_EXCEEDED', 'extraction limits']]) {
      parser.mockRejectedValueOnce(Object.assign(new Error('PRIVATE_UPSTREAM_PATH'), { officeIssue: { code } })); await expect(parseAttachment(raw)).rejects.toThrow(expected);
    }
    const ast = (text: string, warnings: unknown[] = [], messages: unknown[] = []) => ({ warnings, to: vi.fn(async () => ({ value: text, messages })) }) as unknown as OfficeParserAST;
    parser.mockResolvedValueOnce(ast('')); await expect(parseAttachment(raw)).rejects.toThrow('No readable text');
    parser.mockResolvedValueOnce(ast('x'.repeat(256_001))); await expect(parseAttachment(raw)).rejects.toThrow('256,000');
    parser.mockResolvedValueOnce(ast('Recovered text', [{ code: 'PAGE_LOAD_FAILED' }])); await expect(parseAttachment(raw)).rejects.toThrow('integrity');
    parser.mockResolvedValueOnce(ast('Recovered text', [], [{ code: 'TABLE_GRID_LIMIT_EXCEEDED' }])); await expect(parseAttachment(raw)).rejects.toThrow('integrity');
    parser.mockResolvedValueOnce(ast('Good text', [{ code: 'PERFORMANCE_TIP' }], [{ code: 'WHITESPACE_NODE_SKIPPED' }])); expect((await parseAttachment(raw)).content).toBe('Good text');
  });
  it('imports only the first animated frame with an explicit notice and rejects excessive decoded dimensions', async () => {
    const data = Buffer.alloc(32 * 64 * 3); data.fill(180, 0, 32 * 32 * 3); data.fill(60, 32 * 32 * 3);
    const gif = await sharp(data, { raw: { width: 32, height: 64, channels: 3, pageHeight: 32 } }).gif().toBuffer(); const file = await parseAttachment(input('animated.gif', gif));
    expect(file.warnings).toContain('动画图片仅使用第一帧。'); expect(file.image?.height).toBe(32);
    const jpeg = await imageBytes('jpeg'); const marker = jpeg.indexOf(Buffer.from([255, 192])); expect(marker).toBeGreaterThan(0); jpeg.writeUInt16BE(9000, marker + 5); jpeg.writeUInt16BE(5000, marker + 7); await expect(parseAttachment(input('large.jpeg', jpeg))).rejects.toThrow('40 million pixels');
  });
  it('imports a batch atomically, serializes parser work and releases the lock after failure', async () => {
    let release!: () => void; const parser = vi.fn(async (raw) => { await new Promise<void>((resolve) => { release = resolve; }); return { id: 'file', name: raw.name, content: 'Imported' }; }); const importer = new AttachmentImporter(parser);
    const pending = importer.importInputs([input('a.txt', Buffer.from('A'))]); await vi.waitFor(() => expect(parser).toHaveBeenCalledOnce()); await expect(importer.importInputs([input('b.txt', Buffer.from('B'))])).rejects.toThrow('running'); release(); expect(await pending).toHaveLength(1);
    parser.mockRejectedValueOnce(new Error('Invalid file')); await expect(importer.importInputs([input('bad.txt', Buffer.from('B'))])).rejects.toThrow('Invalid file');
    parser.mockResolvedValue({ id: 'file', name: 'good.txt', content: 'Good' }); expect(await importer.importInputs([input('good.txt', Buffer.from('C'))])).toHaveLength(1);
  });
  it('reads native file selections with bounded regular-file checks and safe missing-file errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qiyao-attachments-')); directories.push(directory); const path = join(directory, 'note.txt'); await writeFile(path, 'Unicode 中文'); const importer = new AttachmentImporter(parseAttachment);
    expect((await importer.importPaths([path]))[0]).toMatchObject({ name: 'note.txt', content: 'Unicode 中文' });
    await expect(importer.importPaths([])).rejects.toThrow('1 and 12'); await expect(importer.importPaths([directory])).rejects.toThrow('regular'); await expect(importer.importPaths([join(directory, 'private-missing-name')])).rejects.toThrow('could not be opened');
    await writeFile(path, Buffer.alloc(12_000_001)); await expect(importer.importPaths([path])).rejects.toThrow('12 MB');
  });
  it('bounds browser file input before reading bytes and preserves binary bytes in base64', async () => {
    const bytes = new Uint8Array([0, 255, 128, 65]); const files = [{ name: 'binary.png', size: 4, arrayBuffer: async () => bytes.buffer }] as File[];
    expect(await attachmentInputs(files)).toEqual([{ name: 'binary.png', data: 'AP+AQQ==' }]); await expect(attachmentInputs([])).rejects.toThrow('12');
    const read = vi.fn(); await expect(attachmentInputs([{ name: 'large', size: 12_000_001, arrayBuffer: read }] as unknown as File[])).rejects.toThrow('12 MB'); expect(read).not.toHaveBeenCalled();
    await expect(attachmentInputs([{ ...files[0], size: 5 }])).rejects.toThrow('变化');
  });
  it('terminates workers after success, malformed results, parser errors, crashes, early exit and a hard deadline', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qiyao-parser-worker-')); directories.push(directory); const path = join(directory, 'worker.cjs'); const raw = input('note.txt', Buffer.from('Note'));
    await writeFile(path, "require('node:worker_threads').parentPort.postMessage({ attachment: { id: 'file', name: 'note.txt', content: 'Done' } }); setInterval(() => {}, 1000);"); expect((await parseInWorker(path, raw)).content).toBe('Done');
    await writeFile(path, "require('node:worker_threads').parentPort.postMessage({ attachment: { content: 'Invalid' } });"); await expect(parseInWorker(path, raw)).rejects.toThrow('invalid attachment');
    await writeFile(path, "require('node:worker_threads').parentPort.postMessage({ error: 'Readable parser error' });"); await expect(parseInWorker(path, raw)).rejects.toThrow('Readable parser error');
    await writeFile(path, "throw new Error('PRIVATE_PATH');"); await expect(parseInWorker(path, raw)).rejects.toThrow('unexpectedly');
    await writeFile(path, 'process.exit(0);'); await expect(parseInWorker(path, raw)).rejects.toThrow('before finishing');
    await writeFile(path, 'for (;;) {}'); await expect(parseInWorker(path, raw, 100)).rejects.toThrow('timed out');
  });
});

describe('native model image input and persistence', () => {
  it.each(['responses', 'openai', 'anthropic', 'gemini', 'ollama', 'azure'] as const)('sends %s native image blocks and extracted document evidence', async (kind) => {
    const file = await image(); const document = await parseAttachment(input('document.docx', documentBytes('docx'))); const messages = [message([file, document])];
    const modelInput: ModelInput = { provider: { ...provider, kind }, key: '', model: 'test-model', instructions: '', messages, signal: new AbortController().signal };
    const { body } = modelRequest(modelInput); const history = body.input ?? body.messages ?? body.contents; const serialized = JSON.stringify(history);
    expect(serialized).toContain('Document evidence'); expect(serialized).toContain(file.image!.data); expect(serialized).not.toContain('data:image/png');
    if (kind === 'gemini') expect(history).toMatchObject([{ role: 'user', parts: [{ text: 'Image: image.png' }, { inlineData: { mimeType: 'image/jpeg', data: file.image!.data } }, { text: expect.stringContaining('Document evidence') }] }]);
    else if (kind === 'anthropic') expect(history).toMatchObject([{ role: 'user', content: [{ type: 'text' }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } }, { type: 'text', text: expect.stringContaining('Document evidence') }] }]);
    else expect(serialized).toContain(kind === 'responses' || kind === 'azure' ? 'input_image' : 'image_url');
    expect(modelMessage(message([{ id: 'old', name: 'old.txt', content: 'Notes' }]), 'openai')).toEqual({ role: 'user', content: 'Review files\n\n--- old.txt ---\nNotes' });
  });
  it('rejects invalid images, unsupported models, assistant images, large history and final oversized requests before making any HTTP request', async () => {
    const file = await image(); const blocked = { ...provider, modelCatalog: [{ id: 'test-model', source: 'manual' as const, supportsImages: false }] };
    expect(() => validateModelAttachments(blocked, 'test-model', [message([file])])).toThrow('vision model');
    expect(() => validateModelAttachments(provider, 'test-model', [{ ...message([file]), role: 'assistant' }])).toThrow('user messages');
    expect(() => validateModelAttachments(provider, 'test-model', [message([{ ...file, image: { ...file.image!, data: '/9j/AAAA' } }])])).toThrow('invalid');
    const truncated = Buffer.from(file.image!.data, 'base64'); truncated[truncated.length - 1] = 0; expect(() => validateModelAttachments(provider, 'test-model', [message([{ ...file, image: { ...file.image!, data: truncated.toString('base64') } }])])).toThrow('invalid');
    expect(() => validateModelAttachments(provider, 'test-model', Array.from({ length: 65 }, () => message([file])))).toThrow('request limit');
    expect(() => validateModelAttachments(provider, 'test-model', [message([], 'x'.repeat(16_000_001))])).toThrow('request limit');
    const fetcher = vi.fn(); await expect(new HttpModelGateway(fetcher).stream({ provider, model: 'test-model', key: '', instructions: 'x'.repeat(16_000_001), messages: [], signal: new AbortController().signal }, vi.fn())).rejects.toThrow('16 MB'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('retains a blocked draft without creating a turn, then persists complete images through sending and actual vault restart', async () => {
    const { vault, directory } = await testVault(); directories.push(directory); const file = await image(); const drafts = new ComposerDrafts(vault);
    const draft = { text: request.text, attachments: [file], providerId: provider.id, model: request.model, mode: 'chat' as const, mcpServerIds: [], skillIds: [], pluginIds: [], updatedAt: 1 }; await drafts.save(draft);
    await vault.update((state) => { state.providers[0].modelCatalog = [{ id: request.model, source: 'manual', supportsImages: false }]; });
    const gateway = { stream: vi.fn(async (_input, onText) => { onText('Done'); }) }; const engine = new ConversationEngine(vault, gateway, vi.fn());
    await expect(engine.start({ ...request, attachments: [file], composerRevision: await composerRevision(draft) })).rejects.toThrow('vision model'); expect(vault.snapshot().threads).toEqual([]); expect(vault.snapshot().composerDrafts[0].attachments).toEqual([file]); expect(gateway.stream).not.toHaveBeenCalled();
    await vault.update((state) => { state.providers[0].modelCatalog = [{ id: request.model, source: 'manual', supportsImages: true }]; });
    const result = await engine.start({ ...request, attachments: [file], composerRevision: await composerRevision(draft) }); await engine.settle(result.threadId);
    expect(vault.snapshot().composerDrafts).toEqual([]); const restarted = new WorkspaceVault(directory, codec); await restarted.initialize(); expect(restarted.snapshot().threads[0].messages[0].attachments).toEqual([file]); expect(restarted.snapshot().threads[0].messages.at(-1)?.content).toBe('Done');
  });
});
